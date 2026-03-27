const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("sinavProgramiRobotu", {
  platform: process.platform,
  electronVersion: process.versions.electron,
});
