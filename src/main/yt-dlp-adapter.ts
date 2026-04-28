import type YTDlpWrapType from 'yt-dlp-wrap'

// electron-vite externalizes deps as plain require() without __importDefault,
// so ESM packages with a .default export need this manual unwrap.
// This file isolates the require() so tests can mock it via the adapter.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _mod = require('yt-dlp-wrap')
const YTDlpWrap: typeof YTDlpWrapType = _mod.default ?? _mod

export function createYtDlpInstance(binaryPath: string): InstanceType<typeof YTDlpWrapType> {
  return new YTDlpWrap(binaryPath)
}

export async function downloadYtDlpBinary(binaryPath: string): Promise<void> {
  await YTDlpWrap.downloadFromGithub(binaryPath)
}
