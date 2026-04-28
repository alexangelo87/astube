import { join } from 'path'
import { existsSync, chmodSync } from 'fs'
import { execSync } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import { createYtDlpInstance, downloadYtDlpBinary } from './yt-dlp-adapter'

type YtDlpInstance = ReturnType<typeof createYtDlpInstance>

export type DownloadType = 'single' | 'playlist' | 'batch'

export interface ProgressData {
  percent: number
  totalSize: string
  currentSpeed: string
  eta: string
}

export interface StatusData {
  message: string
  queue?: { current: number; total: number }
}

export interface DownloadOptions {
  type: DownloadType
  url?: string
  urls?: string[]
  quality: string
  format: 'mp4' | 'mp3'
  outputDir: string
  onProgress: (data: ProgressData) => void
  onStatus: (data: StatusData) => void
}

export class Downloader {
  private binaryPath: string
  private ytDlp: YtDlpInstance | null = null
  private abortController: AbortController | null = null
  private cancelled = false
  private ready = false

  constructor(userDataPath: string) {
    const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    this.binaryPath = join(userDataPath, binaryName)
  }

  isReady(): boolean {
    return this.ready
  }

  private findSystemBinary(): string | null {
    const candidates = [
      '/opt/homebrew/bin/yt-dlp',
      '/usr/local/bin/yt-dlp',
      '/usr/bin/yt-dlp',
    ]
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
    try {
      const found = execSync('which yt-dlp', { timeout: 3000 }).toString().trim()
      if (found && existsSync(found)) return found
    } catch { /* not in PATH */ }
    return null
  }

  async ensureBinary(): Promise<void> {
    const system = this.findSystemBinary()
    if (system) {
      this.ytDlp = createYtDlpInstance(system)
      this.ready = true
      return
    }

    if (!existsSync(this.binaryPath)) {
      await downloadYtDlpBinary(this.binaryPath)
      if (process.platform !== 'win32') {
        chmodSync(this.binaryPath, 0o755)
      }
    }
    this.ytDlp = createYtDlpInstance(this.binaryPath)
    this.ready = true
  }

  private getFormatArg(quality: string): string {
    // Prefer H.264 (avc1) + AAC (mp4a) for maximum QuickTime/macOS compatibility.
    // Falls back to any codec at the desired height, then to absolute best.
    const h264Format = (height: number) =>
      `bestvideo[vcodec^=avc1][height<=${height}]+bestaudio[acodec^=mp4a]` +
      `/bestvideo[vcodec^=avc][height<=${height}]+bestaudio` +
      `/bestvideo[height<=${height}]+bestaudio` +
      `/best[height<=${height}]/best`

    switch (quality) {
      case '2160p': return h264Format(2160)
      case '1440p': return h264Format(1440)
      case '1080p': return h264Format(1080)
      case '720p':  return h264Format(720)
      case '480p':  return h264Format(480)
      case '360p':  return h264Format(360)
      default:
        return (
          'bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]' +
          '/bestvideo[vcodec^=avc]+bestaudio' +
          '/bestvideo+bestaudio/best'
        )
    }
  }

  private execDownload(
    args: string[],
    onProgress: (data: ProgressData) => void,
    onStatus: (data: StatusData) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.abortController = new AbortController()

      const emitter = this.ytDlp!.exec(args, {}, this.abortController.signal)

      emitter.on('progress', (p: { percent?: number; totalSize?: string; currentSpeed?: string; eta?: string }) => {
        onProgress({
          percent: p.percent ?? 0,
          totalSize: p.totalSize ?? '',
          currentSpeed: p.currentSpeed ?? '',
          eta: p.eta ?? '',
        })
      })

      emitter.on('ytDlpEvent', (eventType: string, eventData: string) => {
        const line = `[${eventType}] ${eventData}`
        if (
          eventData.includes('Destination:') ||
          eventData.includes('Merging') ||
          eventData.startsWith('Downloading')
        ) {
          onStatus({ message: line })
        }
      })

      emitter.on('error', (err: Error) => {
        if (err.message?.includes('aborted')) {
          resolve()
        } else {
          reject(err)
        }
      })

      emitter.on('close', () => resolve())
    })
  }

  private buildArgs(
    url: string,
    quality: string,
    format: 'mp4' | 'mp3',
    outputTemplate: string,
    ffmpegPath: string,
    extraArgs: string[] = []
  ): string[] {
    if (format === 'mp3') {
      return [
        url,
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', outputTemplate,
        '--ffmpeg-location', ffmpegPath,
        '--newline',
        ...extraArgs,
      ]
    }
    return [
      url,
      '-f', this.getFormatArg(quality),
      '-o', outputTemplate,
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', ffmpegPath,
      '--newline',
      ...extraArgs,
    ]
  }

  async download(options: DownloadOptions): Promise<void> {
    if (!this.ytDlp) throw new Error('yt-dlp não inicializado')
    this.cancelled = false

    const { type, url, urls, quality, format, outputDir, onProgress, onStatus } = options
    const ffmpegPath = ffmpegStatic ?? 'ffmpeg'

    if (type === 'single' && url) {
      onStatus({ message: `Iniciando download: ${url}` })
      await this.execDownload(
        this.buildArgs(url, quality, format, join(outputDir, '%(title)s.%(ext)s'), ffmpegPath),
        onProgress,
        onStatus
      )
    } else if (type === 'playlist' && url) {
      onStatus({ message: `Iniciando download da playlist...` })
      await this.execDownload(
        this.buildArgs(
          url, quality, format,
          join(outputDir, '%(playlist_index)02d - %(title)s.%(ext)s'),
          ffmpegPath,
          ['--yes-playlist']
        ),
        onProgress,
        onStatus
      )
    } else if (type === 'batch' && urls && urls.length > 0) {
      const validUrls = urls.filter((u) => u.trim().length > 0)
      for (let i = 0; i < validUrls.length; i++) {
        if (this.cancelled) break
        const u = validUrls[i]
        onStatus({ message: `Baixando ${i + 1}/${validUrls.length}: ${u}`, queue: { current: i + 1, total: validUrls.length } })
        await this.execDownload(
          this.buildArgs(u, quality, format, join(outputDir, '%(title)s.%(ext)s'), ffmpegPath),
          onProgress,
          onStatus
        )
        if (this.cancelled) break
      }
    }
  }

  cancel(): void {
    this.cancelled = true
    this.abortController?.abort()
    this.abortController = null
  }
}
