import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpc, disposeIpc } from "./ipc.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0b0b0c",
    title: "code-graph",
    webPreferences: {
      preload: path.join(dirname, "../preload/index.js"),
      // The renderer is a plain SPA with no node access — every filesystem touch goes through
      // the typed IPC bridge in ../shared/ipc.ts. Both flags are asserted by a test.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.on("ready-to-show", () => win.show());

  // External links open in the user's browser, never inside the app frame.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // electron-vite serves the renderer over http in dev and points this at it.
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(dirname, "../renderer/index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", disposeIpc);
