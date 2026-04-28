"use strict";
const electron = require("electron");
const trackedHandlers = /* @__PURE__ */ new Map();
function track(channel, handler) {
  const prev = trackedHandlers.get(channel);
  if (prev) electron.ipcRenderer.removeListener(channel, prev);
  trackedHandlers.set(channel, handler);
  electron.ipcRenderer.on(channel, handler);
}
electron.contextBridge.exposeInMainWorld("api", {
  init: () => electron.ipcRenderer.invoke("app:init"),
  getDefaultDownloadDir: () => electron.ipcRenderer.invoke("app:getDefaultDownloadDir"),
  openDirectory: () => electron.ipcRenderer.invoke("dialog:openDirectory"),
  openFile: () => electron.ipcRenderer.invoke("dialog:openFile"),
  readFile: (path) => electron.ipcRenderer.invoke("fs:readFile", path),
  openPath: (path) => electron.ipcRenderer.invoke("shell:openPath", path),
  startDownload: (options) => electron.ipcRenderer.invoke("download:start", options),
  cancelDownload: () => electron.ipcRenderer.invoke("download:cancel"),
  onProgress: (cb) => {
    track("download:progress", (_e, data) => cb(data));
  },
  onStatus: (cb) => {
    track("download:status", (_e, data) => cb(data));
  },
  onComplete: (cb) => {
    track("download:complete", () => cb());
  },
  onError: (cb) => {
    track("download:error", (_e, msg) => cb(msg));
  },
  onInitError: (cb) => {
    track("app:init-error", (_e, msg) => cb(msg));
  },
  removeListeners: (channel) => {
    const handler = trackedHandlers.get(channel);
    if (handler) {
      electron.ipcRenderer.removeListener(channel, handler);
      trackedHandlers.delete(channel);
    }
  },
  removeAllListeners: () => {
    trackedHandlers.forEach((handler, channel) => {
      electron.ipcRenderer.removeListener(channel, handler);
    });
    trackedHandlers.clear();
  }
});
