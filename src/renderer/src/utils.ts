export function parseUrls(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && (l.startsWith('http://') || l.startsWith('https://')))
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function formatQualityLabel(format: 'mp4' | 'mp3', quality: string): string {
  if (format === 'mp3') return 'MP3'
  return quality === 'best' ? 'melhor qualidade' : quality
}
