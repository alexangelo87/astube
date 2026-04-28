import { parseUrls, clampPercent, formatQualityLabel } from './utils'

interface API {
  init: () => Promise<void>
  getDefaultDownloadDir: () => Promise<string>
  openDirectory: () => Promise<string | null>
  openFile: () => Promise<string | null>
  readFile: (path: string) => Promise<string>
  openPath: (path: string) => Promise<void>
  startDownload: (options: object) => Promise<void>
  cancelDownload: () => Promise<void>
  onProgress: (cb: (data: { percent: number; totalSize: string; currentSpeed: string; eta: string }) => void) => void
  onStatus: (cb: (data: { message: string; queue?: { current: number; total: number } }) => void) => void
  onComplete: (cb: () => void) => void
  onError: (cb: (msg: string) => void) => void
  onInitError: (cb: (msg: string) => void) => void
  removeListeners: (channel: string) => void
  removeAllListeners: () => void
}

// Fail fast if the preload script did not expose the API — avoids cryptic
// "Cannot read properties of undefined" errors throughout the app.
function getApi(): API {
  const w = window as unknown as { api?: API }
  if (!w.api) throw new Error('API não exposta pelo preload. Reabra o aplicativo.')
  return w.api
}
const api = getApi()

// ── State ────────────────────────────────────────────────
let currentTab = 'single'
let outputDir = ''
let batchUrls: string[] = []
let isDownloading = false

// ── Elements ─────────────────────────────────────────────
const overlay        = document.getElementById('overlay')!
const overlayMsg     = document.getElementById('overlay-message')!
const tabs           = document.querySelectorAll<HTMLButtonElement>('.tab')
const tabContents    = document.querySelectorAll<HTMLElement>('.tab-content')
const singleUrlInput = document.getElementById('single-url') as HTMLInputElement
const playlistInput  = document.getElementById('playlist-url') as HTMLInputElement
const batchFilePath  = document.getElementById('batch-file-path') as HTMLInputElement
const batchPreview   = document.getElementById('batch-preview')!
const batchInfo      = document.getElementById('batch-info')!
const batchList      = document.getElementById('batch-list')!
const browseFile     = document.getElementById('browse-file')!
const formatSelect   = document.getElementById('format') as HTMLSelectElement
const qualityItem    = document.getElementById('quality-item')!
const qualitySelect  = document.getElementById('quality') as HTMLSelectElement
const outputDirInput = document.getElementById('output-dir') as HTMLInputElement
const browseDirBtn   = document.getElementById('browse-dir')!
const downloadBtn    = document.getElementById('download-btn') as HTMLButtonElement
const cancelBtn      = document.getElementById('cancel-btn') as HTMLButtonElement
const openDirBtn     = document.getElementById('open-dir-btn') as HTMLButtonElement
const progressSection = document.getElementById('progress-section')!
const progressLabel  = document.getElementById('progress-label')!
const progressPercent = document.getElementById('progress-percent')!
const progressFill   = document.getElementById('progress-fill')!
const progressSpeed  = document.getElementById('progress-speed')!
const progressEta    = document.getElementById('progress-eta')!
const progressSize   = document.getElementById('progress-size')!
const logEl          = document.getElementById('log')!
const clearLogBtn    = document.getElementById('clear-log')!

// ── Log ──────────────────────────────────────────────────
function log(message: string, type: 'info' | 'success' | 'error' | 'dim' = 'info'): void {
  const line = document.createElement('div')
  line.className = `log-line ${type}`
  line.textContent = message
  logEl.appendChild(line)
  logEl.scrollTop = logEl.scrollHeight
}

clearLogBtn.addEventListener('click', () => { logEl.innerHTML = '' })

// ── Overlay ───────────────────────────────────────────────
function showOverlay(message: string): void {
  overlayMsg.textContent = message
  overlay.classList.remove('hidden')
}

function hideOverlay(): void {
  overlay.classList.add('hidden')
}

// ── Tabs ─────────────────────────────────────────────────
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab!
    if (isDownloading) return
    currentTab = name
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name))
    tabContents.forEach((c) => c.classList.toggle('active', c.id === `tab-${name}`))
  })
})

// ── Format ────────────────────────────────────────────────
formatSelect.addEventListener('change', () => {
  const isAudio = formatSelect.value === 'mp3'
  qualityItem.style.opacity = isAudio ? '0.4' : ''
  qualityItem.style.pointerEvents = isAudio ? 'none' : ''
})

// ── Settings ──────────────────────────────────────────────
browseDirBtn.addEventListener('click', async () => {
  const dir = await api.openDirectory()
  if (dir) {
    outputDir = dir
    outputDirInput.value = dir
  }
})

// ── Batch file ────────────────────────────────────────────
browseFile.addEventListener('click', async () => {
  const file = await api.openFile()
  if (!file) return

  batchFilePath.value = file

  try {
    const content = await api.readFile(file)
    batchUrls = parseUrls(content)

    batchInfo.textContent = `${batchUrls.length} link${batchUrls.length !== 1 ? 's' : ''} encontrado${batchUrls.length !== 1 ? 's' : ''}`
    batchList.innerHTML = ''
    batchUrls.slice(0, 20).forEach((url) => {
      const li = document.createElement('li')
      li.textContent = url
      batchList.appendChild(li)
    })
    if (batchUrls.length > 20) {
      const li = document.createElement('li')
      li.textContent = `... e mais ${batchUrls.length - 20} links`
      li.style.color = 'var(--text-dim)'
      batchList.appendChild(li)
    }
    batchPreview.classList.remove('hidden')

    log(`Arquivo carregado: ${batchUrls.length} links válidos`)
  } catch (err) {
    log(`Erro ao ler arquivo: ${String(err)}`, 'error')
  }
})

// ── Progress ──────────────────────────────────────────────
function setProgress(percent: number, label?: string): void {
  const pct = clampPercent(percent)
  progressFill.style.width = `${pct}%`
  progressFill.classList.remove('indeterminate')
  progressPercent.textContent = `${Math.round(pct)}%`
  if (label) progressLabel.textContent = label
}

function setIndeterminate(label: string): void {
  progressFill.style.width = '40%'
  progressFill.classList.add('indeterminate')
  progressPercent.textContent = ''
  progressLabel.textContent = label
}

function resetProgress(): void {
  progressFill.style.width = '0%'
  progressFill.classList.remove('indeterminate')
  progressPercent.textContent = '0%'
  progressLabel.textContent = 'Aguardando...'
  progressSpeed.textContent = ''
  progressEta.textContent = ''
  progressSize.textContent = ''
}

// ── Download ──────────────────────────────────────────────
function setDownloading(active: boolean): void {
  isDownloading = active
  downloadBtn.disabled = active
  cancelBtn.disabled = !active
  tabs.forEach((t) => { t.style.pointerEvents = active ? 'none' : '' })

  if (active) {
    progressSection.classList.remove('hidden')
    openDirBtn.classList.add('hidden')
    resetProgress()
    setIndeterminate('Iniciando...')
  }
}

downloadBtn.addEventListener('click', async () => {
  if (isDownloading) return

  const format = formatSelect.value as 'mp4' | 'mp3'
  const quality = qualitySelect.value
  const dir = outputDir || outputDirInput.value

  if (!dir) {
    log('Selecione uma pasta de saída.', 'error')
    return
  }

  const options: Record<string, unknown> = { format, quality, outputDir: dir }

  if (currentTab === 'single') {
    const url = singleUrlInput.value.trim()
    if (!url) { log('Insira a URL do vídeo.', 'error'); return }
    options.type = 'single'
    options.url = url
  } else if (currentTab === 'playlist') {
    const url = playlistInput.value.trim()
    if (!url) { log('Insira a URL da playlist.', 'error'); return }
    options.type = 'playlist'
    options.url = url
  } else {
    if (batchUrls.length === 0) { log('Selecione um arquivo de links .txt.', 'error'); return }
    options.type = 'batch'
    options.urls = batchUrls
  }

  setDownloading(true)
  const qualityLabel = formatQualityLabel(format, quality)
  log(`Iniciando download (${qualityLabel})...`, 'info')

  await api.startDownload(options)
})

cancelBtn.addEventListener('click', async () => {
  await api.cancelDownload()
  log('Download cancelado.', 'dim')
})

openDirBtn.addEventListener('click', () => {
  api.openPath(outputDir || outputDirInput.value)
})

// ── IPC listeners ─────────────────────────────────────────
api.onProgress((data) => {
  if (data.percent > 0) {
    setProgress(data.percent)
  }
  if (data.currentSpeed) progressSpeed.textContent = data.currentSpeed
  if (data.eta)          progressEta.textContent   = `ETA: ${data.eta}`
  if (data.totalSize)    progressSize.textContent   = data.totalSize
})

api.onStatus((data) => {
  if (data.queue) {
    setIndeterminate(`Vídeo ${data.queue.current} de ${data.queue.total}`)
    resetProgress()
  }
  log(data.message, 'dim')
  if (!data.queue) {
    progressLabel.textContent = data.message.replace(/^\[.*?\]\s*/, '').slice(0, 80)
  }
})

api.onComplete(() => {
  setDownloading(false)
  setProgress(100, 'Concluído!')
  progressSpeed.textContent = ''
  progressEta.textContent = ''
  openDirBtn.classList.remove('hidden')
  log('Download concluído com sucesso.', 'success')
})

api.onError((msg) => {
  setDownloading(false)
  resetProgress()
  progressSection.classList.add('hidden')
  log(`Erro: ${msg}`, 'error')
})

// ── Init ──────────────────────────────────────────────────
async function init(): Promise<void> {
  showOverlay('Verificando dependências...')

  api.onInitError((msg) => {
    overlayMsg.textContent = `Erro: ${msg}`
    log(`Erro na inicialização: ${msg}`, 'error')
    // Keep overlay visible and prevent downloads if init fails asynchronously
    downloadBtn.disabled = true
  })

  try {
    await api.init()
    const defaultDir = await api.getDefaultDownloadDir()
    outputDir = defaultDir
    outputDirInput.value = defaultDir
    log('asTube pronto.', 'success')
  } catch (err) {
    const msg = String(err).replace(/^Error:\s*/, '')
    overlayMsg.textContent = `Erro ao inicializar: ${msg}`
    log(`Erro de inicialização: ${msg}`, 'error')
    downloadBtn.disabled = true
    return
  }

  hideOverlay()
}

init()
