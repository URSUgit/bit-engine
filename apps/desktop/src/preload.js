"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getPorts: () => ipcRenderer.invoke("get-ports"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  platform: process.platform,
  isDesktop: true,
});
