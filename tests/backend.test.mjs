import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import ExcelJS from "exceljs";

test("PostgreSQL API authenticates users and returns protected dashboard data", async (context) => {
  const testPort = 41000 + (process.pid % 1000);
  const origin = "http://localhost:3000";
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const adminEmail = "owner@example.com";
  const adminPassword = "Test-only-password-2026!";
  const child = spawn(process.execPath, ["backend/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(testPort),
      FRONTEND_ORIGIN: origin,
      USE_IN_MEMORY_DATABASE: "true",
      SEED_DEMO_DATA: "false",
      ADMIN_EMAIL: adminEmail,
      ADMIN_PASSWORD: adminPassword,
    },
    stdio: "ignore",
  });

  context.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  });

  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        assert.equal((await response.json()).database, "postgres");
        healthy = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(healthy, true, "backend did not become healthy");

  const rejected = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email: adminEmail, password: "incorrect" }),
  });
  assert.equal(rejected.status, 401);

  const oldDemoLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email: "admin@filokreto.com", password: "Demo2026!" }),
  });
  assert.equal(oldDemoLogin.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie?.startsWith("filokreto_session="));

  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie, Origin: origin } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.role, "director");

  const sourceHeaders = {
    "shed-master": ["Shed_ID", "Farm", "Trip_ID", "Area_sqm", "Direct_Floor_Cost", "Contract_Revenue", "Completion_Date"],
    "trip-log": ["Trip_ID", "Farm", "Start_Date", "End_Date", "Sheds_Completed", "Flight_Cost", "Accommodation", "Food_Allowance", "Vehicle_Cost"],
    "nz-invoices": ["Invoice_ID", "Invoice_Month", "Trip_ID", "Labour_Cost_NZD", "Other_Expenses_NZD", "Total_NZD"],
    "au-xero-costs": ["Date", "Reference_ID", "Trip_ID", "Farm", "Category", "Amount_AUD"],
    "fx-rates": ["Month", "NZD_to_AUD_Rate"],
  };
  let tripTemplateBuffer;
  for (const [source, expectedHeaders] of Object.entries(sourceHeaders)) {
    const template = await fetch(`${baseUrl}/api/templates/${source}`, { headers: { Cookie: cookie, Origin: origin } });
    assert.equal(template.status, 200);
    assert.match(template.headers.get("content-type") ?? "", /spreadsheetml/);
    const buffer = Buffer.from(await template.arrayBuffer());
    assert.ok(buffer.byteLength > 1000);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    assert.deepEqual(workbook.worksheets[0].getRow(1).values.slice(1), expectedHeaders);
    if (source === "trip-log") tripTemplateBuffer = buffer;
  }

  const tripWorkbook = new ExcelJS.Workbook();
  await tripWorkbook.xlsx.load(tripTemplateBuffer);
  tripWorkbook.worksheets[0].addRow(["TEST-01", "Quarry Farm", "2026-01-05", "2026-01-12", 2, 1200, 1400, 600, 750]);
  const tripXlsx = Buffer.from(await tripWorkbook.xlsx.writeBuffer());
  const tripImport = await fetch(`${baseUrl}/api/imports/trip-log`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "X-File-Name": "test-trips.xlsx" },
    body: tripXlsx,
  });
  assert.equal(tripImport.status, 201);
  assert.deepEqual(await tripImport.json().then(({ importedRows, updatesDashboard }) => ({ importedRows, updatesDashboard })), { importedRows: 1, updatesDashboard: true });

  const shedCsv = [
    "Shed_ID,Farm,Trip_ID,Area_sqm,Direct_Floor_Cost,Contract_Revenue,Completion_Date",
    "TEST-01-S01,Quarry Farm,TEST-01,2100,44000,89000,2026-01-12",
  ].join("\n");
  const shedImport = await fetch(`${baseUrl}/api/imports/shed-master`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "text/csv", "X-File-Name": "test-sheds.csv" },
    body: shedCsv,
  });
  assert.equal(shedImport.status, 201);

  const archivedImports = [
    ["fx-rates", "Month,NZD_to_AUD_Rate\n2026-01,0.91"],
    ["nz-invoices", "Invoice_ID,Invoice_Month,Trip_ID,Labour_Cost_NZD,Other_Expenses_NZD,Total_NZD\nNZ-001,2026-01,TEST-01,1000,250,1250"],
    ["au-xero-costs", "Date,Reference_ID,Trip_ID,Farm,Category,Amount_AUD\n2026-01-08,AU-001,TEST-01,Quarry Farm,Vehicle,325"],
  ];
  for (const [source, body] of archivedImports) {
    const imported = await fetch(`${baseUrl}/api/imports/${source}`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "text/csv", "X-File-Name": `${source}.csv` },
      body,
    });
    assert.equal(imported.status, 201);
    assert.equal((await imported.json()).updatesDashboard, false);
  }

  const invalidInvoice = await fetch(`${baseUrl}/api/imports/nz-invoices`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "text/csv", "X-File-Name": "invalid.csv" },
    body: "Invoice_ID,Invoice_Month,Trip_ID,Labour_Cost_NZD,Other_Expenses_NZD,Total_NZD\nNZ-002,2026-01,TEST-01,1000,250,1200",
  });
  assert.equal(invalidInvoice.status, 400);
  assert.match((await invalidInvoice.json()).error, /Total_NZD/);

  const createProject = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "TEST-01-S02", tripId: "TEST-01", areaSqm: 2140, directCost: 45000, revenue: 90000, completionDate: "2026-01-12" }),
  });
  assert.equal(createProject.status, 201);

  const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: cookie, Origin: origin } });
  assert.equal(dashboard.status, 200);
  const data = await dashboard.json();
  assert.equal(data.trips.length, 1);
  assert.equal(data.sheds.length, 2);

  const exportResponse = await fetch(`${baseUrl}/api/exports/margin-report?tripId=TEST-01&period=2026`, { headers: { Cookie: cookie, Origin: origin } });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type") ?? "", /spreadsheetml/);
  const report = new ExcelJS.Workbook();
  await report.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
  const reportSheet = report.getWorksheet("Margin report");
  assert.ok(reportSheet);
  assert.deepEqual(reportSheet.getRow(1).values.slice(1), ["Shed ID", "Farm", "Trip ID", "Completion Date", "Area sqm", "Revenue AUD", "Direct Cost AUD", "Allocated Trip Cost AUD", "Total Cost AUD", "Margin AUD", "Margin Percent"]);
  assert.equal(reportSheet.rowCount, 3);
  assert.deepEqual([reportSheet.getCell("A2").value, reportSheet.getCell("A3").value].sort(), ["TEST-01-S01", "TEST-01-S02"]);

  const unauthorizedExport = await fetch(`${baseUrl}/api/exports/margin-report`);
  assert.equal(unauthorizedExport.status, 401);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie, Origin: origin } });
  assert.equal(logout.status, 200);
});
