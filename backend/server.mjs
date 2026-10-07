import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";

const port = Number(process.env.PORT ?? 4000);
const databasePath = resolve(process.env.DATABASE_PATH ?? "backend/data/filokreto.db");
const sessionHours = Number(process.env.SESSION_HOURS ?? 8);
const allowedOrigins = new Set((process.env.FRONTEND_ORIGIN ?? "http://localhost:3000").split(",").map((value) => value.trim()).filter(Boolean));
const cookieSecure = process.env.COOKIE_SECURE === "true";
const cookieSameSite = process.env.COOKIE_SAME_SITE ?? "Lax";

const importSources = {
  "shed-master": { name: "Shed master", columns: ["Shed_ID", "Farm", "Trip_ID", "Area_sqm", "Direct_Floor_Cost", "Contract_Revenue", "Completion_Date"] },
  "trip-log": { name: "Trip log", columns: ["Trip_ID", "Farm", "Start_Date", "End_Date", "Sheds_Completed", "Flight_Cost", "Accommodation", "Food_Allowance", "Vehicle_Cost"] },
  "nz-invoices": { name: "NZ invoices", columns: ["Invoice_ID", "Invoice_Month", "Trip_ID", "Labour_Cost_NZD", "Other_Expenses_NZD", "Total_NZD"] },
  "au-xero-costs": { name: "AU Xero costs", columns: ["Date", "Reference_ID", "Trip_ID", "Farm", "Category", "Amount_AUD"] },
  "fx-rates": { name: "FX rates", columns: ["Month", "NZD_to_AUD_Rate"] },
};

mkdirSync(dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'director',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    farm TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    batch_size INTEGER NOT NULL CHECK (batch_size > 0),
    flight_cost_cents INTEGER NOT NULL,
    accommodation_cents INTEGER NOT NULL,
    allowance_cents INTEGER NOT NULL,
    nz_labour_cents INTEGER NOT NULL,
    au_cost_cents INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sheds (
    id TEXT PRIMARY KEY,
    farm TEXT NOT NULL,
    trip_id TEXT NOT NULL REFERENCES trips(id),
    area_sqm REAL NOT NULL,
    direct_cost_cents INTEGER NOT NULL,
    revenue_cents INTEGER NOT NULL,
    completion_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Complete'
  );
  CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    filename TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    imported_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS import_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    data_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS sheds_farm_idx ON sheds(farm);
  CREATE INDEX IF NOT EXISTS sheds_trip_id_idx ON sheds(trip_id);
`);

const demoTrips = [
  ["MF2-01", "Meriki Farm 2", "2024-03-04", "2024-03-14", 4, 4200, 3450, 1900, 16300, 5400],
  ["MF2-02", "Meriki Farm 2", "2024-04-08", "2024-04-18", 4, 4380, 3510, 1960, 16550, 5120],
  ["MF2-03", "Meriki Farm 2", "2024-05-13", "2024-05-23", 4, 4150, 3680, 2020, 16900, 5480],
  ["SF1-01", "Springdale Farm 1", "2024-07-01", "2024-07-13", 5, 4560, 4250, 2400, 20500, 6340],
  ["SF1-02", "Springdale Farm 1", "2024-08-05", "2024-08-17", 5, 4420, 4380, 2450, 20900, 6180],
  ["SF1-03", "Springdale Farm 1", "2024-09-09", "2024-09-19", 4, 4280, 3660, 1980, 16800, 5250],
  ["SF2-01", "Springdale Farm 2", "2025-02-03", "2025-02-15", 5, 4720, 4460, 2520, 21100, 6520],
  ["SF2-02", "Springdale Farm 2", "2025-03-10", "2025-03-22", 5, 4680, 4550, 2570, 21500, 6410],
  ["SF2-03", "Springdale Farm 2", "2025-04-14", "2025-04-24", 4, 4490, 3820, 2080, 17300, 5590],
  ["QF-01", "Quarry Farm", "2025-07-07", "2025-07-17", 4, 4810, 3940, 2140, 17850, 5820],
  ["QF-02", "Quarry Farm", "2025-08-11", "2025-08-21", 4, 4760, 4020, 2180, 18100, 5960],
  ["QF-03", "Quarry Farm", "2025-09-15", "2025-09-25", 4, 4890, 4080, 2210, 18400, 6110],
];

const farmEconomics = {
  "Meriki Farm 2": { revenue: 90000, direct: 46300, area: 2250 },
  "Springdale Farm 1": { revenue: 85500, direct: 44700, area: 2140 },
  "Springdale Farm 2": { revenue: 88300, direct: 45900, area: 2210 },
  "Quarry Farm": { revenue: 92500, direct: 47900, area: 2320 },
};

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function seedDatabase() {
  const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get("admin@filokreto.com");
  if (!existingUser) {
    const salt = randomBytes(16).toString("hex");
    db.prepare("INSERT INTO users (email, display_name, role, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)")
      .run("admin@filokreto.com", "Filokreto Director", "director", hashPassword("Demo2026!", salt), salt);
  }

  const tripCount = db.prepare("SELECT COUNT(*) AS count FROM trips").get().count;
  if (tripCount > 0) return;

  const insertTrip = db.prepare(`INSERT INTO trips (id, farm, start_date, end_date, batch_size, flight_cost_cents, accommodation_cents, allowance_cents, nz_labour_cents, au_cost_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertShed = db.prepare(`INSERT INTO sheds (id, farm, trip_id, area_sqm, direct_cost_cents, revenue_cents, completion_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Complete')`);

  db.exec("BEGIN");
  try {
    for (const trip of demoTrips) {
      const [id, farm, startDate, endDate, batchSize, flight, accommodation, allowance, nzLabour, auCost] = trip;
      insertTrip.run(id, farm, startDate, endDate, batchSize, flight * 100, accommodation * 100, allowance * 100, nzLabour * 100, auCost * 100);
      const base = farmEconomics[farm];
      for (let index = 0; index < batchSize; index += 1) {
        const sequence = index + 1;
        const revenue = base.revenue + ((index % 4) - 1.5) * 620;
        const directCost = base.direct + ((index % 3) - 1) * 410;
        insertShed.run(`${id}-S${String(sequence).padStart(2, "0")}`, farm, id, base.area + index * 18, Math.round(directCost * 100), Math.round(revenue * 100), endDate);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

seedDatabase();

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-File-Name");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  return !origin || allowedOrigins.has(origin);
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body is too large");
  }
  return body ? JSON.parse(body) : {};
}

async function readBuffer(request, limit = 10_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new ValidationError("The import file exceeds the 10 MB limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

class ValidationError extends Error {}

function cookieValue(request, name) {
  const cookies = (request.headers.cookie ?? "").split(";");
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function sessionUser(request) {
  const token = cookieValue(request, "filokreto_session");
  if (!token) return null;
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  return db.prepare(`SELECT users.id, users.email, users.display_name AS displayName, users.role
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(hashToken(token), new Date().toISOString()) ?? null;
}

function sessionCookie(token, maxAge) {
  const secure = cookieSecure ? "; Secure" : "";
  return `filokreto_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=${cookieSameSite}${secure}`;
}

function mapTrip(row) {
  return {
    id: row.id, farm: row.farm, startDate: row.start_date, endDate: row.end_date, batchSize: row.batch_size,
    flightCost: row.flight_cost_cents / 100, accommodation: row.accommodation_cents / 100,
    allowance: row.allowance_cents / 100, nzLabour: row.nz_labour_cents / 100, auCost: row.au_cost_cents / 100,
  };
}

function mapShed(row) {
  return {
    id: row.id, farm: row.farm, tripId: row.trip_id, areaSqm: row.area_sqm,
    directCost: row.direct_cost_cents / 100, revenue: row.revenue_cents / 100,
    completionDate: row.completion_date, status: row.status,
  };
}

function cellValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === "object") {
    if ("result" in value) return cellValue(value.result);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return value.text;
  }
  return value ?? "";
}

function requiredText(row, column, rowNumber) {
  const value = String(row[column] ?? "").trim();
  if (!value) throw new ValidationError(`Row ${rowNumber}: ${column} is required.`);
  return value;
}

function requiredNumber(row, column, rowNumber, { positive = false, nonNegative = false, integer = false } = {}) {
  const value = Number(row[column]);
  if (!Number.isFinite(value) || (positive && value <= 0) || (nonNegative && value < 0) || (integer && !Number.isInteger(value))) {
    const qualifier = positive ? " positive" : nonNegative ? " non-negative" : "";
    throw new ValidationError(`Row ${rowNumber}: ${column} must be a valid${qualifier}${integer ? " whole" : ""} number.`);
  }
  return value;
}

function requiredDate(row, column, rowNumber) {
  const value = requiredText(row, column, rowNumber);
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`Row ${rowNumber}: ${column} must be a valid date.`);
  return date.toISOString().slice(0, 10);
}

function requiredMonth(row, column, rowNumber) {
  const value = requiredText(row, column, rowNumber);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new ValidationError(`Row ${rowNumber}: ${column} must use YYYY-MM format.`);
  return value;
}

async function parseWorkbook(buffer, filename, source) {
  const workbook = new ExcelJS.Workbook();
  if (filename.toLowerCase().endsWith(".csv")) {
    await workbook.csv.read(Readable.from([buffer]));
  } else {
    await workbook.xlsx.load(buffer);
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new ValidationError("The workbook does not contain a worksheet.");
  const headers = worksheet.getRow(1).values.slice(1).map((value) => String(cellValue(value)).trim());
  const missing = source.columns.filter((column) => !headers.includes(column));
  if (missing.length) throw new ValidationError(`Missing required columns: ${missing.join(", ")}.`);

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (sheetRow, rowNumber) => {
    if (rowNumber === 1) return;
    const record = Object.fromEntries(headers.map((header, index) => [header, cellValue(sheetRow.getCell(index + 1).value)]));
    if (Object.values(record).some((value) => String(value).trim() !== "")) rows.push({ rowNumber, record });
  });
  if (!rows.length) throw new ValidationError("The spreadsheet has headers but no data rows.");
  if (rows.length > 5000) throw new ValidationError("A single import can contain at most 5,000 rows.");
  return rows;
}

async function createTemplate(source) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Filokreto Cost & Margin Monitor";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.columns = source.columns.map((header) => ({ header, key: header, width: Math.max(16, header.length + 3) }));
  const header = worksheet.getRow(1);
  header.height = 26;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF286FD7" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: source.columns.length } };
  return workbook.xlsx.writeBuffer();
}

async function createMarginReport({ farm, tripId, period }) {
  const conditions = [];
  const parameters = [];
  if (farm) {
    conditions.push("sheds.farm = ?");
    parameters.push(farm);
  }
  if (tripId) {
    conditions.push("sheds.trip_id = ?");
    parameters.push(tripId);
  }
  if (period) {
    conditions.push("sheds.completion_date LIKE ?");
    parameters.push(`${period}-%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT sheds.*, trips.batch_size, trips.flight_cost_cents, trips.accommodation_cents,
      trips.allowance_cents, trips.nz_labour_cents, trips.au_cost_cents
    FROM sheds JOIN trips ON trips.id = sheds.trip_id
    ${where}
    ORDER BY sheds.completion_date DESC, sheds.id`).all(...parameters);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Filokreto Cost & Margin Monitor";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Margin report", { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.columns = [
    { header: "Shed ID", key: "shedId", width: 18 },
    { header: "Farm", key: "farm", width: 24 },
    { header: "Trip ID", key: "tripId", width: 15 },
    { header: "Completion Date", key: "completionDate", width: 17 },
    { header: "Area sqm", key: "areaSqm", width: 13 },
    { header: "Revenue AUD", key: "revenue", width: 17 },
    { header: "Direct Cost AUD", key: "directCost", width: 18 },
    { header: "Allocated Trip Cost AUD", key: "logistics", width: 23 },
    { header: "Total Cost AUD", key: "totalCost", width: 17 },
    { header: "Margin AUD", key: "margin", width: 16 },
    { header: "Margin Percent", key: "marginPct", width: 17 },
  ];

  for (const row of rows) {
    const tripCostCents = row.flight_cost_cents + row.accommodation_cents + row.allowance_cents + row.nz_labour_cents + row.au_cost_cents;
    const logistics = tripCostCents / row.batch_size / 100;
    const directCost = row.direct_cost_cents / 100;
    const revenue = row.revenue_cents / 100;
    const totalCost = directCost + logistics;
    const margin = revenue - totalCost;
    worksheet.addRow({
      shedId: row.id,
      farm: row.farm,
      tripId: row.trip_id,
      completionDate: row.completion_date,
      areaSqm: row.area_sqm,
      revenue,
      directCost,
      logistics,
      totalCost,
      margin,
      marginPct: revenue ? margin / revenue : 0,
    });
  }

  const header = worksheet.getRow(1);
  header.height = 26;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF286FD7" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  worksheet.autoFilter = { from: "A1", to: "K1" };
  worksheet.getColumn("completionDate").numFmt = "yyyy-mm-dd";
  worksheet.getColumn("areaSqm").numFmt = "0.00";
  for (const key of ["revenue", "directCost", "logistics", "totalCost", "margin"]) worksheet.getColumn(key).numFmt = '"$"#,##0.00';
  worksheet.getColumn("marginPct").numFmt = "0.00%";
  return workbook.xlsx.writeBuffer();
}

function importRows(sourceKey, source, filename, rows, user) {
  const batchId = randomUUID();
  const insertImportRow = db.prepare("INSERT INTO import_rows (batch_id, row_number, data_json) VALUES (?, ?, ?)");
  const upsertTrip = db.prepare(`INSERT INTO trips (id, farm, start_date, end_date, batch_size, flight_cost_cents, accommodation_cents, allowance_cents, nz_labour_cents, au_cost_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET farm=excluded.farm, start_date=excluded.start_date, end_date=excluded.end_date, batch_size=excluded.batch_size,
      flight_cost_cents=excluded.flight_cost_cents, accommodation_cents=excluded.accommodation_cents, allowance_cents=excluded.allowance_cents, au_cost_cents=excluded.au_cost_cents`);
  const upsertShed = db.prepare(`INSERT INTO sheds (id, farm, trip_id, area_sqm, direct_cost_cents, revenue_cents, completion_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Complete')
    ON CONFLICT(id) DO UPDATE SET farm=excluded.farm, trip_id=excluded.trip_id, area_sqm=excluded.area_sqm, direct_cost_cents=excluded.direct_cost_cents,
      revenue_cents=excluded.revenue_cents, completion_date=excluded.completion_date, status='Complete'`);

  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO import_batches (id, source, filename, row_count, imported_by) VALUES (?, ?, ?, ?, ?)").run(batchId, source.name, filename, rows.length, user.id);
    for (const { rowNumber, record } of rows) {
      if (sourceKey === "trip-log") {
        const startDate = requiredDate(record, "Start_Date", rowNumber);
        const endDate = requiredDate(record, "End_Date", rowNumber);
        if (endDate < startDate) throw new ValidationError(`Row ${rowNumber}: End_Date cannot be before Start_Date.`);
        upsertTrip.run(
          requiredText(record, "Trip_ID", rowNumber), requiredText(record, "Farm", rowNumber), startDate,
          endDate, requiredNumber(record, "Sheds_Completed", rowNumber, { positive: true, integer: true }),
          Math.round(requiredNumber(record, "Flight_Cost", rowNumber, { nonNegative: true }) * 100), Math.round(requiredNumber(record, "Accommodation", rowNumber, { nonNegative: true }) * 100),
          Math.round(requiredNumber(record, "Food_Allowance", rowNumber, { nonNegative: true }) * 100), Math.round(requiredNumber(record, "Vehicle_Cost", rowNumber, { nonNegative: true }) * 100),
        );
      }
      if (sourceKey === "shed-master") {
        const tripId = requiredText(record, "Trip_ID", rowNumber);
        const trip = db.prepare("SELECT id, farm FROM trips WHERE id = ?").get(tripId);
        if (!trip) throw new ValidationError(`Row ${rowNumber}: Trip_ID ${tripId} does not exist. Import the trip log first.`);
        const farm = requiredText(record, "Farm", rowNumber);
        if (trip.farm !== farm) throw new ValidationError(`Row ${rowNumber}: Farm must match the selected trip (${trip.farm}).`);
        upsertShed.run(
          requiredText(record, "Shed_ID", rowNumber), farm, tripId,
          requiredNumber(record, "Area_sqm", rowNumber, { positive: true }), Math.round(requiredNumber(record, "Direct_Floor_Cost", rowNumber, { nonNegative: true }) * 100),
          Math.round(requiredNumber(record, "Contract_Revenue", rowNumber, { nonNegative: true }) * 100), requiredDate(record, "Completion_Date", rowNumber),
        );
      }
      if (sourceKey === "nz-invoices") {
        requiredText(record, "Invoice_ID", rowNumber);
        requiredMonth(record, "Invoice_Month", rowNumber);
        const tripId = requiredText(record, "Trip_ID", rowNumber);
        if (!db.prepare("SELECT id FROM trips WHERE id = ?").get(tripId)) throw new ValidationError(`Row ${rowNumber}: Trip_ID ${tripId} does not exist. Import the trip log first.`);
        const labour = requiredNumber(record, "Labour_Cost_NZD", rowNumber, { nonNegative: true });
        const other = requiredNumber(record, "Other_Expenses_NZD", rowNumber, { nonNegative: true });
        const total = requiredNumber(record, "Total_NZD", rowNumber, { nonNegative: true });
        if (Math.abs(labour + other - total) > 0.01) throw new ValidationError(`Row ${rowNumber}: Total_NZD must equal Labour_Cost_NZD plus Other_Expenses_NZD.`);
      }
      if (sourceKey === "au-xero-costs") {
        requiredDate(record, "Date", rowNumber);
        requiredText(record, "Reference_ID", rowNumber);
        const tripId = requiredText(record, "Trip_ID", rowNumber);
        const trip = db.prepare("SELECT farm FROM trips WHERE id = ?").get(tripId);
        if (!trip) throw new ValidationError(`Row ${rowNumber}: Trip_ID ${tripId} does not exist. Import the trip log first.`);
        const farm = requiredText(record, "Farm", rowNumber);
        if (trip.farm !== farm) throw new ValidationError(`Row ${rowNumber}: Farm must match the selected trip (${trip.farm}).`);
        requiredText(record, "Category", rowNumber);
        requiredNumber(record, "Amount_AUD", rowNumber, { nonNegative: true });
      }
      if (sourceKey === "fx-rates") {
        requiredMonth(record, "Month", rowNumber);
        requiredNumber(record, "NZD_to_AUD_Rate", rowNumber, { positive: true });
      }
      insertImportRow.run(batchId, rowNumber, JSON.stringify(record));
    }
    db.exec("COMMIT");
    return batchId;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const server = createServer(async (request, response) => {
  if (!setCors(request, response)) return sendJson(response, 403, { error: "Origin is not allowed" });
  if (request.method === "OPTIONS") return response.writeHead(204).end();

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { status: "ok", database: "sqlite" });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      const { email = "", password = "" } = await readJson(request);
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).trim().toLowerCase());
      const suppliedHash = user ? Buffer.from(hashPassword(String(password), user.password_salt), "hex") : Buffer.alloc(64);
      const storedHash = user ? Buffer.from(user.password_hash, "hex") : Buffer.alloc(64, 1);
      if (!user || !timingSafeEqual(suppliedHash, storedHash)) return sendJson(response, 401, { error: "Invalid email or password" });

      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000).toISOString();
      db.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)").run(randomUUID(), user.id, hashToken(token), expiresAt);
      return sendJson(response, 200, { user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role } }, { "Set-Cookie": sessionCookie(token, sessionHours * 60 * 60) });
    }

    if (request.method === "GET" && url.pathname === "/api/auth/session") {
      const user = sessionUser(request);
      return user ? sendJson(response, 200, { user }) : sendJson(response, 401, { error: "Not authenticated" });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const token = cookieValue(request, "filokreto_session");
      if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
      return sendJson(response, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
    }

    if (request.method === "GET" && url.pathname === "/api/dashboard") {
      if (!sessionUser(request)) return sendJson(response, 401, { error: "Not authenticated" });
      const trips = db.prepare("SELECT * FROM trips ORDER BY start_date").all().map(mapTrip);
      const sheds = db.prepare("SELECT * FROM sheds ORDER BY completion_date DESC, id").all().map(mapShed);
      return sendJson(response, 200, { trips, sheds });
    }

    if (request.method === "GET" && url.pathname === "/api/exports/margin-report") {
      if (!sessionUser(request)) return sendJson(response, 401, { error: "Not authenticated" });
      const farm = url.searchParams.get("farm")?.trim() ?? "";
      const tripId = url.searchParams.get("tripId")?.trim() ?? "";
      const period = url.searchParams.get("period")?.trim() ?? "";
      if (period && !/^\d{4}$/.test(period)) throw new ValidationError("The report period must be a four-digit year.");
      const buffer = await createMarginReport({ farm, tripId, period });
      response.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="filokreto-margin-report.xlsx"',
        "Cache-Control": "no-store",
      });
      return response.end(Buffer.from(buffer));
    }

    const templateMatch = url.pathname.match(/^\/api\/templates\/([a-z-]+)$/);
    if (request.method === "GET" && templateMatch) {
      if (!sessionUser(request)) return sendJson(response, 401, { error: "Not authenticated" });
      const source = importSources[templateMatch[1]];
      if (!source) return sendJson(response, 404, { error: "Unknown import source" });
      const buffer = await createTemplate(source);
      const filename = `${templateMatch[1]}-template.xlsx`;
      response.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      });
      return response.end(Buffer.from(buffer));
    }

    const importMatch = url.pathname.match(/^\/api\/imports\/([a-z-]+)$/);
    if (request.method === "POST" && importMatch) {
      const user = sessionUser(request);
      if (!user) return sendJson(response, 401, { error: "Not authenticated" });
      const source = importSources[importMatch[1]];
      if (!source) return sendJson(response, 404, { error: "Unknown import source" });
      const filename = decodeURIComponent(String(request.headers["x-file-name"] ?? "import.xlsx"));
      if (!/\.(xlsx|csv)$/i.test(filename)) throw new ValidationError("Only .xlsx and .csv files are accepted.");
      const rows = await parseWorkbook(await readBuffer(request), filename, source);
      const batchId = importRows(importMatch[1], source, filename, rows, user);
      return sendJson(response, 201, { batchId, source: source.name, importedRows: rows.length, updatesDashboard: ["trip-log", "shed-master"].includes(importMatch[1]) });
    }

    if (request.method === "POST" && url.pathname === "/api/projects") {
      const user = sessionUser(request);
      if (!user) return sendJson(response, 401, { error: "Not authenticated" });
      const project = await readJson(request);
      const id = requiredText(project, "id", 1);
      const tripId = requiredText(project, "tripId", 1);
      const trip = db.prepare("SELECT farm FROM trips WHERE id = ?").get(tripId);
      if (!trip) throw new ValidationError("Select an existing trip for this project.");
      if (db.prepare("SELECT id FROM sheds WHERE id = ?").get(id)) throw new ValidationError("A project with this Shed ID already exists.");
      db.prepare(`INSERT INTO sheds (id, farm, trip_id, area_sqm, direct_cost_cents, revenue_cents, completion_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Complete')`).run(
        id, trip.farm, tripId, requiredNumber(project, "areaSqm", 1, { positive: true }),
        Math.round(requiredNumber(project, "directCost", 1) * 100), Math.round(requiredNumber(project, "revenue", 1) * 100),
        requiredDate(project, "completionDate", 1),
      );
      return sendJson(response, 201, { project: mapShed(db.prepare("SELECT * FROM sheds WHERE id = ?").get(id)) });
    }

    return sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    if (error instanceof ValidationError) return sendJson(response, 400, { error: error.message });
    return sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Filokreto API listening on http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
