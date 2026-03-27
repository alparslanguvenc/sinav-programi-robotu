const { app, BrowserWindow, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const PRODUCT_NAME = "Sınav Programı Robotu";
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow = null;

const resolveIconPath = () => {
  const candidate = path.join(__dirname, "..", "buildResources", "icon.png");
  return fs.existsSync(candidate) ? candidate : undefined;
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
