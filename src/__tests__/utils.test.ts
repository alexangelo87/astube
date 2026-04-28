import { describe, it, expect } from 'vitest'
import { parseUrls, clampPercent, formatQualityLabel } from '../renderer/src/utils'

// ── parseUrls ─────────────────────────────────────────────

describe('parseUrls', () => {
  it('returns https URLs', () => {
    const result = parseUrls('https://youtube.com/watch?v=abc')
    expect(result).toEqual(['https://youtube.com/watch?v=abc'])
  })

  it('returns http URLs', () => {
    expect(parseUrls('http://example.com')).toEqual(['http://example.com'])
  })

  it('returns multiple URLs from multiline content', () => {
    const content = 'https://youtube.com/watch?v=a\nhttps://youtube.com/watch?v=b'
    expect(parseUrls(content)).toEqual([
      'https://youtube.com/watch?v=a',
      'https://youtube.com/watch?v=b',
    ])
  })

  it('trims leading and trailing whitespace from each line', () => {
    expect(parseUrls('  https://youtube.com/watch?v=abc  ')).toEqual([
      'https://youtube.com/watch?v=abc',
    ])
  })

  it('filters out empty lines', () => {
    const content = '\n\nhttps://youtube.com/watch?v=abc\n\n'
    expect(parseUrls(content)).toEqual(['https://youtube.com/watch?v=abc'])
  })

  it('filters out whitespace-only lines', () => {
    const content = '   \nhttps://youtube.com/watch?v=abc\n   '
    expect(parseUrls(content)).toEqual(['https://youtube.com/watch?v=abc'])
  })

  it('filters out plain text that is not a URL', () => {
    const content = 'not a url\nhttps://youtube.com/watch?v=abc\n# comment'
    expect(parseUrls(content)).toEqual(['https://youtube.com/watch?v=abc'])
  })

  it('filters out ftp:// and other non-http protocols', () => {
    expect(parseUrls('ftp://example.com\nhttps://youtube.com/watch?v=abc')).toEqual([
      'https://youtube.com/watch?v=abc',
    ])
  })

  it('returns an empty array for an empty string', () => {
    expect(parseUrls('')).toEqual([])
  })

  it('returns an empty array when no line is a valid URL', () => {
    expect(parseUrls('no urls\nhere\nat all')).toEqual([])
  })
})

// ── clampPercent ──────────────────────────────────────────

describe('clampPercent', () => {
  it('returns the value unchanged when within 0–100', () => {
    expect(clampPercent(0)).toBe(0)
    expect(clampPercent(50)).toBe(50)
    expect(clampPercent(100)).toBe(100)
  })

  it('clamps values below 0 to 0', () => {
    expect(clampPercent(-1)).toBe(0)
    expect(clampPercent(-999)).toBe(0)
  })

  it('clamps values above 100 to 100', () => {
    expect(clampPercent(101)).toBe(100)
    expect(clampPercent(200)).toBe(100)
  })

  it('handles floating-point values', () => {
    expect(clampPercent(42.7)).toBeCloseTo(42.7)
    expect(clampPercent(-0.1)).toBe(0)
    expect(clampPercent(100.1)).toBe(100)
  })
})

// ── formatQualityLabel ────────────────────────────────────

describe('formatQualityLabel', () => {
  it('returns "MP3" for mp3 format regardless of quality value', () => {
    expect(formatQualityLabel('mp3', '1080p')).toBe('MP3')
    expect(formatQualityLabel('mp3', '720p')).toBe('MP3')
    expect(formatQualityLabel('mp3', 'best')).toBe('MP3')
  })

  it('returns "melhor qualidade" for mp4 with quality = "best"', () => {
    expect(formatQualityLabel('mp4', 'best')).toBe('melhor qualidade')
  })

  it('returns the quality string as-is for mp4 with specific resolutions', () => {
    expect(formatQualityLabel('mp4', '1080p')).toBe('1080p')
    expect(formatQualityLabel('mp4', '720p')).toBe('720p')
    expect(formatQualityLabel('mp4', '2160p')).toBe('2160p')
    expect(formatQualityLabel('mp4', '360p')).toBe('360p')
  })
})
