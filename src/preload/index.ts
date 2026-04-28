import { contextBridge, ipcRenderer } from 'electron'

type ProgressCallback = (data: { percent: number; totalSize: string; currentSpeed: string; eta: string }) => void
type StatusCallback = (data: { message: string; queue?: { current: number; total: number } }) => void
type IpcHandler = (...args: unknown[]) => void

// Tracks bound handlers so each channel has at most one listener and all can
// be properly removed (avoids accumulating duplicate callbacks across calls).
const trackedHandlers = new Map<string, IpcHandler>()

function track(channel: string, handler: IpcHandler): void {
  const prev = trackedHandlers.get(channel)
  if (prev) ipcRenderer.removeListener(channel, prev)
  trackedHandlers.set(channel, handler)
  ipcRenderer.on(channel, handler)
}

contextBridge.exposeInMainWorld('api', {
  init: (): Promise<void> =>
    ipcRenderer.invoke('app:init'),

  getDefaultDownloadDir: (): Promise<string> =>
    ipcRenderer.invoke('app:getDefaultDownloadDir'),

  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),

  openFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openFile'),

  readFile: (path: string): Promise<string> =>
    ipcRenderer.invoke('fs:readFile', path),

  openPath: (path: string): Promise<void> =>
    ipcRenderer.invoke('shell:openPath', path),

  startDownload: (options: object): Promise<void> =>
    ipcRenderer.invoke('download:start', options),

  cancelDownload: (): Promise<void> =>
    ipcRenderer.invoke('download:cancel'),

  onProgress: (cb: ProgressCallback) => {
    track('download:progress', (_e, data) => cb(data as Parameters<ProgressCallback>[0]))
  },
  onStatus: (cb: StatusCallback) => {
    track('download:status', (_e, data) => cb(data as Parameters<StatusCallback>[0]))
  },
  onComplete: (cb: () => void) => {
    track('download:complete', () => cb())
  },
  onError: (cb: (msg: string) => void) => {
    track('download:error', (_e, msg) => cb(msg as string))
  },
  onInitError: (cb: (msg: string) => void) => {
    track('app:init-error', (_e, msg) => cb(msg as string))
  },

  removeListeners: (channel: string) => {
    const handler = trackedHandlers.get(channel)
    if (handler) {
      ipcRenderer.removeListener(channel, handler)
      trackedHandlers.delete(channel)
    }
  },

  removeAllListeners: () => {
    trackedHandlers.forEach((handler, channel) => {
      ipcRenderer.removeListener(channel, handler)
    })
    trackedHandlers.clear()
  },
})
