const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sinavProgramiRobotu", {
  platform: process.platform,
  electronVersion: process.versions.electron,
  storage: {
    readSync: () => ipcRenderer.sendSync("persistent-storage:read-sync"),
    writeSync: (payload) => ipcRenderer.sendSync("persistent-storage:write-sync", payload),
  },
});
