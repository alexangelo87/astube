import sharp from 'sharp'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const svg = readFileSync(join(root, 'resources', 'icon.svg'))

const sizes = [16, 32, 48, 64, 128, 256, 512, 1024]

for (const size of sizes) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(join(root, 'resources', `icon-${size}.png`))
  console.log(`✓ icon-${size}.png`)
}

// Main icon used by electron-builder (1024x1024)
await sharp(svg)
  .resize(1024, 1024)
  .png()
  .toFile(join(root, 'resources', 'icon.png'))

console.log('✓ icon.png (1024x1024) — pronto para electron-builder')
