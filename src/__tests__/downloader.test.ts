import { EventEmitter } from 'events'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────
// vi.hoisted() ensures these values exist when the vi.mock() factory runs,
// which is hoisted to the top of the file before any imports.
const { mockExec, mockCreateInstance, mockDownloadBinary } = vi.hoisted(() => {
  const mockExec = vi.fn()
  const mockCreateInstance = vi.fn(() => ({ exec: mockExec }))
  const mockDownloadBinary = vi.fn().mockResolvedValue(undefined)
  return { mockExec, mockCreateInstance, mockDownloadBinary }
})

// Mock the local adapter (Vitest reliably intercepts local-file imports).
// The yt-dlp-wrap require() unwrap is isolated inside yt-dlp-adapter.ts, so
// we never need to mock the CJS package directly.
vi.mock('../main/yt-dlp-adapter', () => ({
  createYtDlpInstance: mockCreateInstance,
  downloadYtDlpBinary: mockDownloadBinary,
}))

vi.mock('ffmpeg-static', () => ({ default: '/mock/ffmpeg' }))
vi.mock('fs', () => ({ existsSync: vi.fn().mockReturnValue(false), chmodSync: vi.fn() }))
vi.mock('child_process', () => ({
  execSync: vi.fn().mockImplementation(() => { throw new Error('not found') }),
}))

import { Downloader } from '../main/downloader'
import { existsSync, chmodSync } from 'fs'

// ── Helpers ───────────────────────────────────────────────

// Creates an EventEmitter that emits the given events then 'close', all async.
function makeEmitter(events: Array<{ name: string; args: unknown[] }> = []): EventEmitter {
  const em = new EventEmitter()
  process.nextTick(() => {
    for (const { name, args } of events) em.emit(name, ...args)
    em.emit('close')
  })
  return em
}

const BASE_OPTIONS = {
  url: 'https://youtube.com/watch?v=abc',
  quality: '1080p',
  format: 'mp4' as const,
  outputDir: '/output',
  onProgress: vi.fn(),
  onStatus: vi.fn(),
}

// ── Tests ─────────────────────────────────────────────────

describe('Downloader', () => {
  let downloader: Downloader

  beforeEach(() => {
    vi.clearAllMocks()
    downloader = new Downloader('/mock/userData')
    mockExec.mockReturnValue(makeEmitter())
  })

  // ── ensureBinary ─────────────────────────────────────────

  describe('ensureBinary', () => {
    it('uses system binary when found at a known path', async () => {
      vi.mocked(existsSync).mockImplementation((p) => p === '/opt/homebrew/bin/yt-dlp')

      await downloader.ensureBinary()

      expect(mockCreateInstance).toHaveBeenCalledWith('/opt/homebrew/bin/yt-dlp')
      expect(mockDownloadBinary).not.toHaveBeenCalled()
    })

    it('downloads binary from GitHub when no binary is found', async () => {
      vi.mocked(existsSync).mockReturnValue(false)

      await downloader.ensureBinary()

      expect(mockDownloadBinary).toHaveBeenCalledWith(
        expect.stringContaining('yt-dlp')
      )
    })

    it('skips GitHub download when binary file already exists locally', async () => {
      vi.mocked(existsSync).mockImplementation(
        (p) => typeof p === 'string' && p.includes('userData')
      )

      await downloader.ensureBinary()

      expect(mockDownloadBinary).not.toHaveBeenCalled()
    })

    it('sets chmod 755 on non-Windows after GitHub download', async () => {
      vi.mocked(existsSync).mockReturnValue(false)

      await downloader.ensureBinary()

      if (process.platform !== 'win32') {
        expect(chmodSync).toHaveBeenCalledWith(expect.any(String), 0o755)
      }
    })

    it('sets ready = true after success', async () => {
      vi.mocked(existsSync).mockImplementation((p) => p === '/opt/homebrew/bin/yt-dlp')

      await downloader.ensureBinary()

      expect(downloader.isReady()).toBe(true)
    })
  })

  // ── isReady ───────────────────────────────────────────────

  describe('isReady', () => {
    it('returns false before ensureBinary is called', () => {
      expect(downloader.isReady()).toBe(false)
    })

    it('returns true after successful ensureBinary', async () => {
      vi.mocked(existsSync).mockImplementation((p) => p === '/opt/homebrew/bin/yt-dlp')
      await downloader.ensureBinary()

      expect(downloader.isReady()).toBe(true)
    })
  })

  // ── Helper: initialize without calling ensureBinary() ────
  // Directly injects the mock ytDlp instance, bypassing binary resolution.
  function setupReady(): void {
    ;(downloader as unknown as Record<string, unknown>).ytDlp = { exec: mockExec }
    ;(downloader as unknown as Record<string, unknown>).ready = true
  }

  // ── download – uninitialized ──────────────────────────────

  describe('download – not initialized', () => {
    it('throws when yt-dlp has not been initialized', async () => {
      await expect(
        downloader.download({ type: 'single', ...BASE_OPTIONS })
      ).rejects.toThrow('yt-dlp não inicializado')
    })
  })

  // ── download – single MP4 ────────────────────────────────

  describe('download – single MP4', () => {
    it('passes the URL as the first exec argument', async () => {
      setupReady()
      await downloader.download({ type: 'single', ...BASE_OPTIONS })

      const [args] = mockExec.mock.calls[0]
      expect(args[0]).toBe(BASE_OPTIONS.url)
    })

    it('includes -f format selector and --merge-output-format mp4', async () => {
      setupReady()
      await downloader.download({ type: 'single', ...BASE_OPTIONS })

      const [args] = mockExec.mock.calls[0]
      expect(args).toContain('-f')
      expect(args).toContain('--merge-output-format')
      expect(args).toContain('mp4')
    })

    it('does not include audio-extraction flags', async () => {
      setupReady()
      await downloader.download({ type: 'single', ...BASE_OPTIONS })

      const [args] = mockExec.mock.calls[0]
      expect(args).not.toContain('-x')
      expect(args).not.toContain('--audio-format')
    })

    it('uses %(title)s output template inside the output dir', async () => {
      setupReady()
      await downloader.download({ type: 'single', ...BASE_OPTIONS })

      const [args] = mockExec.mock.calls[0]
      const outputValue = args[args.indexOf('-o') + 1] as string
      expect(outputValue).toContain('%(title)s')
      expect(outputValue).toContain('/output')
    })

    it('passes the ffmpeg path to --ffmpeg-location', async () => {
      setupReady()
      await downloader.download({ type: 'single', ...BASE_OPTIONS })

      const [args] = mockExec.mock.calls[0]
      expect(args).toContain('--ffmpeg-location')
      expect(args).toContain('/mock/ffmpeg')
    })

    it('calls onStatus with a message containing the URL', async () => {
      setupReady()
      const onStatus = vi.fn()
      await downloader.download({ type: 'single', ...BASE_OPTIONS, onStatus })

      expect(onStatus).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining(BASE_OPTIONS.url) })
      )
    })
  })

  // ── download – single MP3 ────────────────────────────────

  describe('download – single MP3', () => {
    const mp3Options = { ...BASE_OPTIONS, format: 'mp3' as const }

    it('uses -x --audio-format mp3 --audio-quality 0', async () => {
      setupReady()
      await downloader.download({ type: 'single', ...mp3Options })

      const [args] = mockExec.mock.calls[0]
      expect(args).toContain('-x')
      expect(args).toContain('--audio-format')
      expect(args).toContain('mp3')
      expect(args).toContain('--audio-quality')
      expect(args).toContain('0')
    })

    it('does not include --merge-output-format', async () => {
      setupReady()
      await downloader.download({ type: 'single', ...mp3Options })

      const [args] = mockExec.mock.calls[0]
      expect(args).not.toContain('--merge-output-format')
    })

    it('does not include -f video format selector', async () => {
      setupReady()
      await downloader.download({ type: 'single', ...mp3Options })

      const [args] = mockExec.mock.calls[0]
      expect(args).not.toContain('-f')
    })

    it('still passes --ffmpeg-location for audio conversion', async () => {
      setupReady()
      await downloader.download({ type: 'single', ...mp3Options })

      const [args] = mockExec.mock.calls[0]
      expect(args).toContain('--ffmpeg-location')
    })
  })

  // ── download – playlist ───────────────────────────────────

  describe('download – playlist', () => {
    const playlistUrl = 'https://youtube.com/playlist?list=PLxyz'

    it('includes --yes-playlist flag', async () => {
      setupReady()
      await downloader.download({ type: 'playlist', ...BASE_OPTIONS, url: playlistUrl })

      const [args] = mockExec.mock.calls[0]
      expect(args).toContain('--yes-playlist')
    })

    it('uses numbered %(playlist_index) output template', async () => {
      setupReady()
      await downloader.download({ type: 'playlist', ...BASE_OPTIONS, url: playlistUrl })

      const [args] = mockExec.mock.calls[0]
      const outputValue = args[args.indexOf('-o') + 1] as string
      expect(outputValue).toContain('%(playlist_index)')
    })

    it('supports MP3 format and still includes --yes-playlist', async () => {
      setupReady()
      await downloader.download({
        type: 'playlist', ...BASE_OPTIONS, url: playlistUrl, format: 'mp3',
      })

      const [args] = mockExec.mock.calls[0]
      expect(args).toContain('-x')
      expect(args).toContain('--yes-playlist')
    })

    it('calls exec exactly once for a playlist', async () => {
      setupReady()
      await downloader.download({ type: 'playlist', ...BASE_OPTIONS, url: playlistUrl })

      expect(mockExec).toHaveBeenCalledTimes(1)
    })
  })

  // ── download – batch ──────────────────────────────────────

  describe('download – batch', () => {
    const urls = [
      'https://youtube.com/watch?v=a',
      'https://youtube.com/watch?v=b',
      'https://youtube.com/watch?v=c',
    ]

    it('calls exec once per URL', async () => {
      setupReady()
      mockExec.mockImplementation(() => makeEmitter())

      await downloader.download({ type: 'batch', ...BASE_OPTIONS, urls })

      expect(mockExec).toHaveBeenCalledTimes(urls.length)
    })

    it('passes each URL as the first argument of its exec call', async () => {
      setupReady()
      mockExec.mockImplementation(() => makeEmitter())

      await downloader.download({ type: 'batch', ...BASE_OPTIONS, urls })

      const calledUrls = mockExec.mock.calls.map((c) => c[0][0])
      expect(calledUrls).toEqual(urls)
    })

    it('reports queue progress for each URL', async () => {
      setupReady()
      mockExec.mockImplementation(() => makeEmitter())
      const onStatus = vi.fn()

      await downloader.download({ type: 'batch', ...BASE_OPTIONS, urls: urls.slice(0, 2), onStatus })

      const queueCalls = onStatus.mock.calls.filter((c) => c[0].queue)
      expect(queueCalls[0][0].queue).toEqual({ current: 1, total: 2 })
      expect(queueCalls[1][0].queue).toEqual({ current: 2, total: 2 })
    })

    it('filters empty strings from the urls array', async () => {
      setupReady()
      mockExec.mockImplementation(() => makeEmitter())

      await downloader.download({
        type: 'batch', ...BASE_OPTIONS,
        urls: ['https://youtube.com/watch?v=a', '', '   ', 'https://youtube.com/watch?v=b'],
      })

      expect(mockExec).toHaveBeenCalledTimes(2)
    })

    it('applies MP3 args to every URL in the batch', async () => {
      setupReady()
      mockExec.mockImplementation(() => makeEmitter())

      await downloader.download({ type: 'batch', ...BASE_OPTIONS, format: 'mp3', urls })

      for (const call of mockExec.mock.calls) {
        expect(call[0]).toContain('-x')
        expect(call[0]).toContain('--audio-format')
        expect(call[0]).not.toContain('--merge-output-format')
      }
    })

    it('stops processing after the abort signal is set', async () => {
      setupReady()

      let callCount = 0
      mockExec.mockImplementation(() => {
        callCount++
        if (callCount === 1) process.nextTick(() => downloader.cancel())
        return makeEmitter()
      })

      await downloader.download({ type: 'batch', ...BASE_OPTIONS, urls })

      expect(mockExec.mock.calls.length).toBeLessThan(urls.length)
    })
  })

  // ── progress and status callbacks ────────────────────────

  describe('progress callbacks', () => {
    it('calls onProgress with the data from the progress event', async () => {
      setupReady()
      const progressData = { percent: 42, totalSize: '100MB', currentSpeed: '1MB/s', eta: '1:00' }
      mockExec.mockReturnValue(makeEmitter([{ name: 'progress', args: [progressData] }]))
      const onProgress = vi.fn()

      await downloader.download({ type: 'single', ...BASE_OPTIONS, onProgress })

      expect(onProgress).toHaveBeenCalledWith(progressData)
    })

    it('fills missing progress fields with empty-string defaults', async () => {
      setupReady()
      mockExec.mockReturnValue(makeEmitter([{ name: 'progress', args: [{}] }]))
      const onProgress = vi.fn()

      await downloader.download({ type: 'single', ...BASE_OPTIONS, onProgress })

      expect(onProgress).toHaveBeenCalledWith({
        percent: 0, totalSize: '', currentSpeed: '', eta: '',
      })
    })

    it('calls onStatus when yt-dlp emits a Destination event', async () => {
      setupReady()
      mockExec.mockReturnValue(
        makeEmitter([{ name: 'ytDlpEvent', args: ['download', 'Destination: video.mp4'] }])
      )
      const onStatus = vi.fn()

      await downloader.download({ type: 'single', ...BASE_OPTIONS, onStatus })

      const destinationCall = onStatus.mock.calls.find((c) =>
        c[0].message.includes('Destination:')
      )
      expect(destinationCall).toBeDefined()
    })

    it('does not forward unrelated yt-dlp events to onStatus', async () => {
      setupReady()
      mockExec.mockReturnValue(
        makeEmitter([{ name: 'ytDlpEvent', args: ['generic', 'some unrelated info'] }])
      )
      const onStatus = vi.fn()

      await downloader.download({ type: 'single', ...BASE_OPTIONS, onStatus })

      const hasUnrelated = onStatus.mock.calls.some((c) =>
        c[0].message.includes('some unrelated info')
      )
      expect(hasUnrelated).toBe(false)
    })

    it('resolves (does not reject) when error message contains "aborted"', async () => {
      setupReady()
      const em = new EventEmitter()
      mockExec.mockReturnValue(em)
      // Schedule after listeners are registered synchronously inside execDownload()
      process.nextTick(() => em.emit('error', new Error('aborted')))

      await expect(
        downloader.download({ type: 'single', ...BASE_OPTIONS })
      ).resolves.toBeUndefined()
    })

    it('rejects when a real (non-abort) error is emitted', async () => {
      setupReady()
      const em = new EventEmitter()
      mockExec.mockReturnValue(em)
      process.nextTick(() => em.emit('error', new Error('network failure')))

      await expect(
        downloader.download({ type: 'single', ...BASE_OPTIONS })
      ).rejects.toThrow('network failure')
    })
  })

  // ── cancel ────────────────────────────────────────────────

  describe('cancel', () => {
    it('does not throw when called with no active download', () => {
      expect(() => downloader.cancel()).not.toThrow()
    })

    it('resolves an in-flight download when combined with an abort error', async () => {
      setupReady()
      const em = new EventEmitter()
      mockExec.mockReturnValue(em)

      // start the download (listeners are registered synchronously inside execDownload)
      const downloadPromise = downloader.download({ type: 'single', ...BASE_OPTIONS })

      // cancel and simulate the abort error that yt-dlp would emit
      downloader.cancel()
      em.emit('error', new Error('aborted'))

      await expect(downloadPromise).resolves.toBeUndefined()
    })
  })

  // ── getFormatArg – quality strings ───────────────────────

  describe('getFormatArg (via exec args)', () => {
    const qualityCases = [
      { quality: '2160p', height: '2160' },
      { quality: '1440p', height: '1440' },
      { quality: '1080p', height: '1080' },
      { quality: '720p',  height: '720'  },
      { quality: '480p',  height: '480'  },
      { quality: '360p',  height: '360'  },
    ]

    it.each(qualityCases)(
      '$quality format string contains height $height',
      async ({ quality, height }) => {
        setupReady()
        await downloader.download({ type: 'single', ...BASE_OPTIONS, quality })

        const [args] = mockExec.mock.calls[0]
        const formatStr = args[args.indexOf('-f') + 1] as string
        expect(formatStr).toContain(height)
      }
    )

    it('includes avc1 and mp4a for QuickTime compatibility', async () => {
      setupReady()
      await downloader.download({ type: 'single', ...BASE_OPTIONS, quality: '1080p' })

      const [args] = mockExec.mock.calls[0]
      const formatStr = args[args.indexOf('-f') + 1] as string
      expect(formatStr).toContain('avc1')
      expect(formatStr).toContain('mp4a')
    })

    it('"best" quality does not constrain height', async () => {
      setupReady()
      await downloader.download({ type: 'single', ...BASE_OPTIONS, quality: 'best' })

      const [args] = mockExec.mock.calls[0]
      const formatStr = args[args.indexOf('-f') + 1] as string
      expect(formatStr).toContain('bestvideo')
      expect(formatStr).not.toMatch(/height<=\d/)
    })

    it('"best" quality still prefers H.264 codec', async () => {
      setupReady()
      await downloader.download({ type: 'single', ...BASE_OPTIONS, quality: 'best' })

      const [args] = mockExec.mock.calls[0]
      const formatStr = args[args.indexOf('-f') + 1] as string
      expect(formatStr).toContain('avc1')
    })
  })
})
