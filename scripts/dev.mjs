import { spawn } from "node:child_process";

function runNpmScript(script) {
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm.cmd run ${script}`], { stdio: "inherit" });
  }
  return spawn("npm", ["run", script], { stdio: "inherit" });
}

const children = [runNpmScript("backend:dev"), runNpmScript("frontend:dev")];

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 250);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping && code !== 0) stop(code ?? 1);
  });
  child.on("error", () => stop(1));
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
