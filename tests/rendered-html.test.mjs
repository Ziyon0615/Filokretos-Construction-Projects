import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Filokreto login", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Filokreto \| Cost &amp; Margin Monitor<\/title>/i);
  assert.match(html, /Welcome back/);
  assert.match(html, /Margin Intelligence/);
  assert.match(html, /Authorized users only/);
  assert.doesNotMatch(html, /Demo workspace access|Demo2026!/);
  assert.doesNotMatch(html, /codex-preview/);
});

test("starter preview and implementation details are no longer referenced", async () => {
  const [page, layout, packageJson, dashboardApp] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard-app.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview|codex-preview/);
  assert.match(page, /DashboardApp/);
  assert.match(layout, /Filokreto/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(dashboardApp, /Demo workspace access|Local SQLite database|SQLite data|imported into SQLite/);
  assert.match(dashboardApp, /filokreto-margin-report\.xlsx/);
});
