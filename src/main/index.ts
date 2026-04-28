import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join, resolve, sep } from 'path'
import { readFile } from 'fs/promises'
import { Downloader, DownloadOptions } from './downloader'

function resolveIcon(): string {
  // In a packaged app the icon is placed in extraResources (process.resourcesPath).
  // In dev mode it lives in the project's resources/ folder.
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
}

type StartDownloadPayload = Omit<DownloadOptions, 'onProgress' | 'onStatus'>

let mainWindow: BrowserWindow | null = null
let downloader: Downloader
let initPromise: Promise<void>
let isDownloading = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 720,
    minHeight: 580,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0F0F0F',
    // icon is used on Windows/Linux for the taskbar; macOS uses the app bundle icon
    icon: resolveIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'asTube',
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    // Cancel any active download so the yt-dlp child process is not orphaned
    downloader?.cancel()
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // Set the asTube icon in the macOS dock (overrides the default Electron binary icon)
  if (process.platform === 'darwin') {
    app.dock?.setIcon(resolveIcon())
  }

  downloader = new Downloader(app.getPath('userData'))
  initPromise = downloader.ensureBinary().catch((err) => {
    mainWindow?.webContents.send('app:init-error', String(err.message))
    throw err
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Warn before quitting mid-download
app.on('before-quit', (event) => {
  if (!isDownloading || !mainWindow) return
  event.preventDefault()
  dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Download em andamento',
    message: 'Um download está em andamento. Deseja cancelar e sair?',
    buttons: ['Cancelar e sair', 'Continuar'],
    defaultId: 1,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) {
      downloader.cancel()
      app.exit(0)
    }
  })
})

ipcMain.handle('app:init', () => initPromise)

ipcMain.handle('app:getDefaultDownloadDir', () => app.getPath('downloads'))

ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:openFile', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Arquivos de texto', extensions: ['txt'] }],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('fs:readFile', async (_event, filePath: unknown) => {
  if (typeof filePath !== 'string' || filePath.includes('\0')) {
    throw new Error('Caminho inválido')
  }
  const resolved = resolve(filePath)
  if (!resolved.endsWith('.txt')) {
    throw new Error('Somente arquivos .txt são permitidos')
  }
  return readFile(resolved, 'utf-8')
})

ipcMain.handle('shell:openPath', async (_event, inputPath: unknown) => {
  if (typeof inputPath !== 'string' || inputPath.includes('\0')) {
    throw new Error('Caminho inválido')
  }
  const resolved = resolve(inputPath)
  const home = app.getPath('home')
  // Restrict to paths under the user's home directory
  if (resolved !== home && !resolved.startsWith(home + sep)) {
    throw new Error('Acesso negado: caminho fora do diretório permitido')
  }
  await shell.openPath(resolved)
})

ipcMain.handle('download:start', async (_event, options: StartDownloadPayload) => {
  isDownloading = true
  try {
    await downloader.download({
      ...options,
      onProgress: (data) => mainWindow?.webContents.send('download:progress', data),
      onStatus: (data) => mainWindow?.webContents.send('download:status', data),
    })
    mainWindow?.webContents.send('download:complete')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    mainWindow?.webContents.send('download:error', message)
  } finally {
    isDownloading = false
  }
})

ipcMain.handle('download:cancel', () => {
  downloader.cancel()
})
