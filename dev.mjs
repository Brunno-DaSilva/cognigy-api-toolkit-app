import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";
const backendDir = path.join(__dirname, "cognigy-api-toolkit-backend");

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

const services = [
  {
    name: "client",
    color: "\x1b[36m",
    cwd: path.join(__dirname, "cognigy-api-toolkit-client"),
    command: "npm run dev",
  },
  {
    name: "backend",
    color: "\x1b[35m",
    cwd: backendDir,
    command: "npx supabase functions serve --no-verify-jwt",
  },
];

function prefix(name, color) {
  return `${color}[${name}]${RESET}`;
}

function pipeStream(stream, label, isErr = false) {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      const out = isErr ? process.stderr : process.stdout;
      out.write(`${label} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buf.length) {
      const out = isErr ? process.stderr : process.stdout;
      out.write(`${label} ${buf}\n`);
    }
  });
}

function runToCompletion(name, color, cwd, command) {
  return new Promise((resolve, reject) => {
    const label = prefix(name, color);
    process.stdout.write(`${label} ${DIM}running "${command}"${RESET}\n`);
    const child = spawn(command, { cwd, shell: true, env: process.env });
    pipeStream(child.stdout, label, false);
    pipeStream(child.stderr, label, true);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} exited with code ${code}`));
    });
  });
}

function isSupabaseRunning() {
  return new Promise((resolve) => {
    const child = spawn("npx supabase status", {
      cwd: backendDir,
      shell: true,
      env: process.env,
      stdio: "ignore",
    });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

const children = [];
let shuttingDown = false;
let exitCode = 0;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`\n${DIM}Stopping services (${signal})...${RESET}\n`);
  for (const child of children) {
    if (child.exitCode !== null) continue;
    try {
      if (isWindows) {
        spawn("taskkill", ["/pid", child.pid, "/f", "/t"]);
      } else {
        child.kill(signal);
      }
    } catch {}
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function main() {
  const supabaseLabel = prefix("supabase", "\x1b[33m");

  const alreadyRunning = await isSupabaseRunning();
  if (alreadyRunning) {
    process.stdout.write(
      `${supabaseLabel} ${DIM}local stack already running, skipping start${RESET}\n`,
    );
  } else {
    try {
      await runToCompletion(
        "supabase",
        "\x1b[33m",
        backendDir,
        "npx supabase start",
      );
    } catch (err) {
      process.stderr.write(
        `${supabaseLabel} failed to start: ${err.message}\n` +
          `${supabaseLabel} ${DIM}is Docker Desktop running?${RESET}\n`,
      );
      process.exit(1);
    }
  }

  let alive = services.length;

  for (const svc of services) {
    const label = prefix(svc.name, svc.color);
    process.stdout.write(
      `${label} ${DIM}starting "${svc.command}" in ${svc.cwd}${RESET}\n`,
    );
    const child = spawn(svc.command, {
      cwd: svc.cwd,
      shell: true,
      env: process.env,
    });
    children.push(child);

    pipeStream(child.stdout, label, false);
    pipeStream(child.stderr, label, true);

    child.on("error", (err) => {
      process.stderr.write(`${label} failed to start: ${err.message}\n`);
    });

    child.on("exit", (code, signal) => {
      process.stdout.write(
        `${label} ${DIM}exited (code=${code}, signal=${signal})${RESET}\n`,
      );
      if (code && code !== 0 && exitCode === 0) exitCode = code;
      alive -= 1;
      if (alive === 0) {
        process.exit(exitCode);
      } else if (!shuttingDown) {
        shutdown("SIGTERM");
      }
    });
  }
}

main();
