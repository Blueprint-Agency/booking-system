/**
 * The studio's logo, fetched to draw on a Receipt PDF (#386).
 *
 * **Never the reason a PDF fails.** Whatever goes wrong — no logo, an address
 * that is not one, a host that refuses, answers late or never, a page that is
 * not an image, an image PDFKit could not draw — the answer is `null`, and the
 * Receipt shows the studio's name alone. Only PNG and JPEG are taken, the two
 * formats PDFKit can draw.
 */
import { inflateSync } from 'node:zlib'
import { outbound } from '../../lib/outbound'
import { logger } from '../../shared/logger'

/** Bigger than any logo needs to be, small enough to hold in memory per request. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024
/** Width × height: a logo drawn 160 points wide needs nowhere near this many. */
const MAX_LOGO_PIXELS = 4096 * 4096

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The logo's bytes, ready to draw, or null to go without. */
export async function studioLogo(url: string | null): Promise<Buffer | null> {
  if (!url) return null
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return null
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return null

  let bytes: Buffer
  try {
    // The outbound door logs how each try ended; a failure is not retried,
    // because a member is waiting on the download.
    bytes = await outbound('logo', 'fetch', signal => fetchCapped(target, signal))
  } catch {
    return null
  }
  if (!drawable(bytes)) {
    logger.warn({ host: target.host, bytes: bytes.length }, 'studio logo is not a PNG or JPEG PDFKit can draw')
    return null
  }
  return bytes
}

async function fetchCapped(url: URL, signal: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, { signal, redirect: 'follow' })
  if (!res.ok || !res.body) {
    await res.body?.cancel()
    throw Object.assign(new Error(`logo host answered ${res.status}`), { statusCode: res.status })
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of res.body) {
    size += chunk.byteLength
    if (size > MAX_LOGO_BYTES) {
      await res.body.cancel().catch(() => {})
      throw new Error(`logo is over ${MAX_LOGO_BYTES} bytes`)
    }
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * Whether PDFKit can draw it without failing. A PNG is inflated here first:
 * PDFKit decodes one in a callback that throws where nothing can catch it, so a
 * damaged PNG must never reach it.
 */
function drawable(bytes: Buffer): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return false
  try {
    const idat: Buffer[] = []
    let width = 0
    let height = 0
    for (let at = 8; at + 8 <= bytes.length; ) {
      const length = bytes.readUInt32BE(at)
      const type = bytes.toString('latin1', at + 4, at + 8)
      const data = bytes.subarray(at + 8, at + 8 + length)
      if (data.length !== length) return false
      if (type === 'IHDR') {
        width = data.readUInt32BE(0)
        height = data.readUInt32BE(4)
      }
      if (type === 'IDAT') idat.push(data)
      if (type === 'IEND') break
      at += 12 + length
    }
    if (width === 0 || height === 0 || width * height > MAX_LOGO_PIXELS || idat.length === 0) return false
    // At most eight bytes a pixel (16-bit RGBA) and a filter byte a row: more
    // than that is not this image, and is not inflated into memory.
    inflateSync(Buffer.concat(idat), { maxOutputLength: width * height * 8 + height })
    return true
  } catch {
    return false
  }
}
