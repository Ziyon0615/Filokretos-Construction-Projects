import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("SQLite API authenticates users and returns protected dashboard data", async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "filokreto-api-"));
  const testPort = 41000 + (process.pid % 1000);
  const origin = "http://localhost:3000";
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const child = spawn(process.execPath, ["backend/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(testPort),
      FRONTEND_ORIGIN: origin,
      DATABASE_PATH: join(temporaryDirectory, "test.db"),
    },
    stdio: "ignore",
  });

  context.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
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
    body: JSON.stringify({ email: "admin@filokreto.com", password: "incorrect" }),
  });
  assert.equal(rejected.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email: "admin@filokreto.com", password: "Demo2026!" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie?.startsWith("filokreto_session="));

  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie, Origin: origin } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.role, "director");

  const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: cookie, Origin: origin } });
  assert.equal(dashboard.status, 200);
  const data = await dashboard.json();
  assert.equal(data.trips.length, 12);
  assert.equal(data.sheds.length, 52);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie, Origin: origin } });
  assert.equal(logout.status, 200);
});
