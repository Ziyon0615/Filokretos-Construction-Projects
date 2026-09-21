import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const port = Number(process.env.PORT ?? 4000);
const databasePath = resolve(process.env.DATABASE_PATH ?? "backend/data/filokreto.db");
const sessionHours = Number(process.env.SESSION_HOURS ?? 8);
const allowedOrigins = new Set((process.env.FRONTEND_ORIGIN ?? "http://localhost:3000").split(",").map((value) => value.trim()).filter(Boolean));
const cookieSecure = process.env.COOKIE_SECURE === "true";
const cookieSameSite = process.env.COOKIE_SAME_SITE ?? "Lax";

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
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

    return sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
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
