"use strict";

const { app, BrowserWindow, Menu, Tray, shell, ipcMain, nativeImage } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const log = require("electron-log");
const http = require("http");

// ─── Config ──────────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === "development";
const PORTS = { web: 3000, signal: 8001, gateway: 8080 };
const SERVICES_READY_TIMEOUT_MS = 60_000;

log.transports.file.level = "info";
log.info("BitPrivat desktop starting…");

// ─── State ───────────────────────────────────────────────────────────────────

let mainWindow = null;
let splashWindow = null;
let tray = null;
const procs = [];   // child processes we spawned

// ─── Helpers ─────────────────────────────────────────────────────────────────

function waitForPort(port, timeoutMs = SERVICES_READY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
        } else {
          setTimeout(check, 1000);
        }
      });
      req.setTimeout(800, () => req.destroy());
    };
    check();
  });
}

function findExecutable(names) {
  const { execSync } = require("child_process");
  for (const name of names) {
    try {
      const out = execSync(
        process.platform === "win32" ? `where ${name}` : `which ${name}`,
        { stdio: "pipe" }
      ).toString().trim().split("\n")[0].trim();
      if (out && fs.existsSync(out)) return out;
    } catch (_) {}
  }
  return null;
}

function spawnService(label, cmd, args, cwd, env = {}) {
  log.info(`[${label}] starting: ${cmd} ${args.join(" ")}`);
  const proc = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
    windowsHide: true,
  });
  proc.stdout.on("data", (d) => log.info(`[${label}] ${d.toString().trim()}`));
  proc.stderr.on("data", (d) => log.warn(`[${label}] ${d.toString().trim()}`));
  proc.on("exit", (code) => log.info(`[${label}] exited with code ${code}`));
  procs.push(proc);
  return proc;
}

function killAll() {
  log.info("Killing all child processes…");
  for (const p of procs) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", p.pid.toString(), "/f", "/t"], { shell: true });
      } else {
        process.kill(-p.pid, "SIGTERM");
      }
    } catch (_) {}
  }
}

// ─── Root paths ──────────────────────────────────────────────────────────────

const ROOT = IS_DEV
  ? path.join(__dirname, "..", "..", "..")
  : path.join(process.resourcesPath, "..");

const WEB_DIR = path.join(ROOT, "apps", "web");
const SIGNAL_DIR = path.join(ROOT, "apps", "signal-service");

// ─── Splash window ───────────────────────────────────────────────────────────

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    backgroundColor: "#020617",
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
}

function updateSplash(msg) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send("status", msg);
  }
}

// ─── Main window ─────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: "#020617",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORTS.web}`);

  mainWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("closed", () => { mainWindow = null; });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // App menu
  const menu = Menu.buildFromTemplate([
    {
      label: "BitPrivat",
      submenu: [
        { label: "About", role: "about" },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Dashboard", click: () => mainWindow?.loadURL(`http://127.0.0.1:${PORTS.web}/dashboard`) },
        { label: "Strategy Lab", click: () => mainWindow?.loadURL(`http://127.0.0.1:${PORTS.web}/lab`) },
        { label: "AI Agent", click: () => mainWindow?.loadURL(`http://127.0.0.1:${PORTS.web}/lab/agent`) },
        { label: "Polymarket Bot", click: () => mainWindow?.loadURL(`http://127.0.0.1:${PORTS.web}/lab/polymarket`) },
        { type: "separator" },
        { label: "API Docs (Signal Service)", click: () => shell.openExternal(`http://127.0.0.1:${PORTS.signal}/docs`) },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { role: "togglefullscreen" },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, "..", "assets", "tray.png");
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip("BitPrivat");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open BitPrivat", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: "separator" },
    { label: "Dashboard", click: () => mainWindow?.loadURL(`http://127.0.0.1:${PORTS.web}/dashboard`) },
    { label: "Polymarket Bot", click: () => mainWindow?.loadURL(`http://127.0.0.1:${PORTS.web}/lab/polymarket`) },
    { label: "AI Agent", click: () => mainWindow?.loadURL(`http://127.0.0.1:${PORTS.web}/lab/agent`) },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
  tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ─── Service launcher ────────────────────────────────────────────────────────

async function startServices() {
  // 1. Signal service (Python)
  updateSplash("Starting signal service…");
  const python = findExecutable(["python3", "python", "py"]);
  if (!python) {
    log.warn("Python not found — signal service won't start");
    updateSplash("⚠ Python not found, skipping signal service");
  } else {
    const uvicorn = findExecutable(["uvicorn"]) || `${python} -m uvicorn`;
    const venvPython = path.join(SIGNAL_DIR, ".venv", "Scripts", "python.exe");   // Windows venv
    const venvPython2 = path.join(SIGNAL_DIR, ".venv", "bin", "python");          // Unix venv
    const py = fs.existsSync(venvPython) ? venvPython
             : fs.existsSync(venvPython2) ? venvPython2
             : python;

    spawnService(
      "signal-svc",
      py,
      ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", PORTS.signal.toString()],
      SIGNAL_DIR,
      { PYTHONUNBUFFERED: "1" }
    );

    try {
      await waitForPort(PORTS.signal, 30_000);
      log.info("Signal service ready");
    } catch {
      log.warn("Signal service did not start in time");
    }
  }

  // 2. Next.js web app
  updateSplash("Starting web app…");
  const npx = findExecutable(["npx", "npx.cmd"]);
  const node = findExecutable(["node"]);

  if (!node) {
    throw new Error("Node.js not found. Please install Node.js from https://nodejs.org");
  }

  // Prefer `next start` (production build) but fall back to `next dev`
  const nextBin = path.join(WEB_DIR, "node_modules", ".bin",
    process.platform === "win32" ? "next.cmd" : "next");

  const hasNextBin = fs.existsSync(nextBin);
  const hasBuild = fs.existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"));

  if (hasNextBin && hasBuild) {
    spawnService("web", nextBin, ["start", "--port", PORTS.web.toString()], WEB_DIR);
  } else if (hasNextBin) {
    spawnService("web", nextBin, ["dev", "--port", PORTS.web.toString()], WEB_DIR);
  } else if (npx) {
    spawnService("web", npx, ["next", "dev", "--port", PORTS.web.toString()], WEB_DIR);
  } else {
    throw new Error("Next.js not found. Run `pnpm install` in the repo root first.");
  }

  updateSplash("Waiting for web app…");
  await waitForPort(PORTS.web, 60_000);
  log.info("Web app ready");
}

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createSplash();
  createTray();

  try {
    await startServices();
    createMainWindow();
  } catch (err) {
    log.error("Failed to start services:", err);
    updateSplash(`Error: ${err.message}`);
    // Show error for 5s then quit
    setTimeout(() => app.quit(), 5000);
    return;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createMainWindow();
});

app.on("before-quit", killAll);
app.on("will-quit", killAll);

// IPC from renderer
ipcMain.handle("get-ports", () => PORTS);
ipcMain.handle("open-external", (_, url) => shell.openExternal(url));
