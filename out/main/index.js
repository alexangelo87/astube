"use strict";
const electron = require("electron");
const path = require("path");
const promises = require("fs/promises");
const fs = require("fs");
const child_process = require("child_process");
const ffmpegStatic = require("ffmpeg-static");
const _mod = require("yt-dlp-wrap");
const YTDlpWrap = _mod.default ?? _mod;
function createYtDlpInstance(binaryPath) {
  return new YTDlpWrap(binaryPath);
}
async function downloadYtDlpBinary(binaryPath) {
  await YTDlpWrap.downloadFromGithub(binaryPath);
}
class Downloader {
  binaryPath;
  ytDlp = null;
  abortController = null;
  cancelled = false;
  ready = false;
  constructor(userDataPath) {
    const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
    this.binaryPath = path.join(userDataPath, binaryName);
  }
  isReady() {
    return this.ready;
  }
  findSystemBinary() {
    const candidates = [
      "/opt/homebrew/bin/yt-dlp",
      "/usr/local/bin/yt-dlp",
      "/usr/bin/yt-dlp"
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    try {
      const found = child_process.execSync("which yt-dlp", { timeout: 3e3 }).toString().trim();
      if (found && fs.existsSync(found)) return found;
    } catch {
    }
    return null;
  }
  async ensureBinary() {
    const system = this.findSystemBinary();
    if (system) {
      this.ytDlp = createYtDlpInstance(system);
      this.ready = true;
      return;
    }
    if (!fs.existsSync(this.binaryPath)) {
      await downloadYtDlpBinary(this.binaryPath);
      if (process.platform !== "win32") {
        fs.chmodSync(this.binaryPath, 493);
      }
    }
    this.ytDlp = createYtDlpInstance(this.binaryPath);
    this.ready = true;
  }
  getFormatArg(quality) {
    const h264Format = (height) => `bestvideo[vcodec^=avc1][height<=${height}]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc][height<=${height}]+bestaudio/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
    switch (quality) {
      case "2160p":
        return h264Format(2160);
      case "1440p":
        return h264Format(1440);
      case "1080p":
        return h264Format(1080);
      case "720p":
        return h264Format(720);
      case "480p":
        return h264Format(480);
      case "360p":
        return h264Format(360);
      default:
        return "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc]+bestaudio/bestvideo+bestaudio/best";
    }
  }
  execDownload(args, onProgress, onStatus) {
    return new Promise((resolve, reject) => {
      this.abortController = new AbortController();
      const emitter = this.ytDlp.exec(args, {}, this.abortController.signal);
      emitter.on("progress", (p) => {
        onProgress({
          percent: p.percent ?? 0,
          totalSize: p.totalSize ?? "",
          currentSpeed: p.currentSpeed ?? "",
          eta: p.eta ?? ""
        });
      });
      emitter.on("ytDlpEvent", (eventType, eventData) => {
        const line = `[${eventType}] ${eventData}`;
        if (eventData.includes("Destination:") || eventData.includes("Merging") || eventData.startsWith("Downloading")) {
          onStatus({ message: line });
        }
      });
      emitter.on("error", (err) => {
        if (err.message?.includes("aborted")) {
          resolve();
        } else {
          reject(err);
        }
      });
      emitter.on("close", () => resolve());
    });
  }
  buildArgs(url, quality, format, outputTemplate, ffmpegPath, extraArgs = []) {
    if (format === "mp3") {
      return [
        url,
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "-o",
        outputTemplate,
        "--ffmpeg-location",
        ffmpegPath,
        "--newline",
        ...extraArgs
      ];
    }
    return [
      url,
      "-f",
      this.getFormatArg(quality),
      "-o",
      outputTemplate,
      "--merge-output-format",
      "mp4",
      "--ffmpeg-location",
      ffmpegPath,
      "--newline",
      ...extraArgs
    ];
  }
  async download(options) {
    if (!this.ytDlp) throw new Error("yt-dlp não inicializado");
    this.cancelled = false;
    const { type, url, urls, quality, format, outputDir, onProgress, onStatus } = options;
    const ffmpegPath = ffmpegStatic ?? "ffmpeg";
    if (type === "single" && url) {
      onStatus({ message: `Iniciando download: ${url}` });
      await this.execDownload(
        this.buildArgs(url, quality, format, path.join(outputDir, "%(title)s.%(ext)s"), ffmpegPath),
        onProgress,
        onStatus
      );
    } else if (type === "playlist" && url) {
      onStatus({ message: `Iniciando download da playlist...` });
      await this.execDownload(
        this.buildArgs(
          url,
          quality,
          format,
          path.join(outputDir, "%(playlist_index)02d - %(title)s.%(ext)s"),
          ffmpegPath,
          ["--yes-playlist"]
        ),
        onProgress,
        onStatus
      );
    } else if (type === "batch" && urls && urls.length > 0) {
      const validUrls = urls.filter((u) => u.trim().length > 0);
      for (let i = 0; i < validUrls.length; i++) {
        if (this.cancelled) break;
        const u = validUrls[i];
        onStatus({ message: `Baixando ${i + 1}/${validUrls.length}: ${u}`, queue: { current: i + 1, total: validUrls.length } });
        await this.execDownload(
          this.buildArgs(u, quality, format, path.join(outputDir, "%(title)s.%(ext)s"), ffmpegPath),
          onProgress,
          onStatus
        );
        if (this.cancelled) break;
      }
    }
  }
  cancel() {
    this.cancelled = true;
    this.abortController?.abort();
    this.abortController = null;
  }
}
function resolveIcon() {
  return electron.app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.join(electron.app.getAppPath(), "resources", "icon.png");
}
let mainWindow = null;
let downloader;
let initPromise;
let isDownloading = false;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 720,
    minHeight: 580,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0F0F0F",
    // icon is used on Windows/Linux for the taskbar; macOS uses the app bundle icon
    icon: resolveIcon(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: "asTube"
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  mainWindow.on("closed", () => {
    downloader?.cancel();
    mainWindow = null;
  });
}
electron.app.whenReady().then(() => {
  if (process.platform === "darwin") {
    electron.app.dock?.setIcon(resolveIcon());
  }
  downloader = new Downloader(electron.app.getPath("userData"));
  initPromise = downloader.ensureBinary().catch((err) => {
    mainWindow?.webContents.send("app:init-error", String(err.message));
    throw err;
  });
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", (event) => {
  if (!isDownloading || !mainWindow) return;
  event.preventDefault();
  electron.dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Download em andamento",
    message: "Um download está em andamento. Deseja cancelar e sair?",
    buttons: ["Cancelar e sair", "Continuar"],
    defaultId: 1,
    cancelId: 1
  }).then(({ response }) => {
    if (response === 0) {
      downloader.cancel();
      electron.app.exit(0);
    }
  });
});
electron.ipcMain.handle("app:init", () => initPromise);
electron.ipcMain.handle("app:getDefaultDownloadDir", () => electron.app.getPath("downloads"));
electron.ipcMain.handle("dialog:openDirectory", async () => {
  if (!mainWindow) return null;
  const result = await electron.dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"]
  });
  return result.canceled ? null : result.filePaths[0];
});
electron.ipcMain.handle("dialog:openFile", async () => {
  if (!mainWindow) return null;
  const result = await electron.dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Arquivos de texto", extensions: ["txt"] }]
  });
  return result.canceled ? null : result.filePaths[0];
});
electron.ipcMain.handle("fs:readFile", async (_event, filePath) => {
  if (typeof filePath !== "string" || filePath.includes("\0")) {
    throw new Error("Caminho inválido");
  }
  const resolved = path.resolve(filePath);
  if (!resolved.endsWith(".txt")) {
    throw new Error("Somente arquivos .txt são permitidos");
  }
  return promises.readFile(resolved, "utf-8");
});
electron.ipcMain.handle("shell:openPath", async (_event, inputPath) => {
  if (typeof inputPath !== "string" || inputPath.includes("\0")) {
    throw new Error("Caminho inválido");
  }
  const resolved = path.resolve(inputPath);
  const home = electron.app.getPath("home");
  if (resolved !== home && !resolved.startsWith(home + path.sep)) {
    throw new Error("Acesso negado: caminho fora do diretório permitido");
  }
  await electron.shell.openPath(resolved);
});
electron.ipcMain.handle("download:start", async (_event, options) => {
  isDownloading = true;
  try {
    await downloader.download({
      ...options,
      onProgress: (data) => mainWindow?.webContents.send("download:progress", data),
      onStatus: (data) => mainWindow?.webContents.send("download:status", data)
    });
    mainWindow?.webContents.send("download:complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    mainWindow?.webContents.send("download:error", message);
  } finally {
    isDownloading = false;
  }
});
electron.ipcMain.handle("download:cancel", () => {
  downloader.cancel();
});
