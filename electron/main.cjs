const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const PRODUCT_NAME = "Sınav Programı Robotu";
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const DESKTOP_STATE_FILE = "desktop-state.json";

let mainWindow = null;

const resolveIconPath = () => {
  const candidate = path.join(__dirname, "..", "buildResources", "icon.png");
  return fs.existsSync(candidate) ? candidate : undefined;
};

const resolveDesktopStatePath = () => path.join(app.getPath("userData"), DESKTOP_STATE_FILE);

const readDesktopState = () => {
  try {
    const storagePath = resolveDesktopStatePath();

    if (!fs.existsSync(storagePath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(storagePath, "utf8"));
  } catch {
    return {};
  }
};

const writeDesktopState = (payload) => {
  const storagePath = resolveDesktopStatePath();
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(storagePath, JSON.stringify(payload, null, 2), "utf8");
};

const createMainWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    title: PRODUCT_NAME,
    backgroundColor: "#f6f2e9",
    autoHideMenuBar: false,
    icon: resolveIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
      partition: "persist:sinav-programi-robotu",
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (DEV_SERVER_URL) {
    await mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
};

app.setName(PRODUCT_NAME);

ipcMain.on("persistent-storage:read-sync", (event) => {
  event.returnValue = readDesktopState();
});

ipcMain.on("persistent-storage:write-sync", (event, payload) => {
  try {
    writeDesktopState(payload ?? {});
    event.returnValue = { ok: true };
  } catch (error) {
    event.returnValue = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

app.whenReady().then(async () => {
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
