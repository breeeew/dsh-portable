/**
 * Minimal, dependency-free tar + gzip helpers for the portable archive.
 *
 * The archive is deliberately a plain `tar.gz` so it can be inspected with
 * standard tools (7-Zip, `tar tzf`) and so the plugin does not need a zip
 * library. Only regular files and directories are written; the reader
 * rejects links, devices and any path that would escape the extraction
 * root, which keeps a hand-crafted or corrupted archive from writing
 * outside `.dsh-portable/staging/<id>`.
 */
import { createReadStream, createWriteStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'

const BLOCK = 512

function octal(value, digits) {
  const text = Math.max(0, Math.trunc(value)).toString(8)
  return text.padStart(digits, '0') + '\0'
}

function writeString(header, offset, length, text) {
  const bytes = Buffer.from(text, 'utf8')
  bytes.copy(header, offset, 0, Math.min(bytes.length, length))
}

/** Encode one ustar header block. */
export function tarHeader({ name, size = 0, mode = 0o644, mtime = Math.floor(Date.now() / 1000), type = '0' }) {
  const header = Buffer.alloc(BLOCK)
  let prefix = ''
  let entryName = name

  if (Buffer.byteLength(entryName, 'utf8') > 100) {
    const text = entryName
    let split = -1
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== '/') continue
      const left = Buffer.byteLength(text.slice(0, index), 'utf8')
      const right = Buffer.byteLength(text.slice(index + 1), 'utf8')
      if (left <= 155 && right <= 100) split = index
    }
    if (split < 0) throw new Error(`tar: entry path is too long: ${name}`)
    prefix = text.slice(0, split)
    entryName = text.slice(split + 1)
  }

  writeString(header, 0, 100, entryName)
  writeString(header, 100, 8, octal(mode, 7))
  writeString(header, 108, 8, octal(0, 7))
  writeString(header, 116, 8, octal(0, 7))
  writeString(header, 124, 12, octal(size, 11))
  writeString(header, 136, 12, octal(mtime, 11))
  header.fill(0x20, 148, 156)
  header[156] = type.charCodeAt(0)
  writeString(header, 257, 6, 'ustar\0')
  writeString(header, 263, 2, '00')
  writeString(header, 265, 32, 'root')
  writeString(header, 297, 32, 'root')
  writeString(header, 345, 155, prefix)

  let checksum = 0
  for (const byte of header) checksum += byte
  writeString(header, 148, 8, checksum.toString(8).padStart(6, '0') + '\0 ')

  return header
}

function paddingFor(size) {
  return (BLOCK - (size % BLOCK)) % BLOCK
}

/**
 * Yield one tar archive.
 *
 * Entries are either `{ name, buffer }` for in-memory content or
 * `{ name, abs }` for a filesystem path. A file that shrank between the
 * scan and the read is zero-padded so the archive stays structurally valid;
 * a file that grew contributes only the size announced in its header.
 */
export async function* tarEntries(entries) {
  for (const entry of entries) {
    if (entry.buffer !== undefined) {
      yield tarHeader({ name: entry.name, size: entry.buffer.length, mode: entry.mode ?? 0o644 })
      if (entry.buffer.length > 0) yield entry.buffer
      const padding = paddingFor(entry.buffer.length)
      if (padding > 0) yield Buffer.alloc(padding)
      continue
    }

    let stat
    try {
      stat = await fsp.lstat(entry.abs)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      yield tarHeader({
        name: entry.name.endsWith('/') ? entry.name : `${entry.name}/`,
        size: 0,
        mode: 0o755,
        type: '5',
      })
      continue
    }

    if (!stat.isFile()) continue

    yield tarHeader({ name: entry.name, size: stat.size, mode: 0o644 })
    let written = 0
    if (stat.size > 0) {
      for await (const chunk of createReadStream(entry.abs, { start: 0, end: stat.size - 1 })) {
        written += chunk.length
        yield chunk
      }
    }
    if (written < stat.size) yield Buffer.alloc(stat.size - written)
    const padding = paddingFor(stat.size)
    if (padding > 0) yield Buffer.alloc(padding)
  }

  // Two zero blocks terminate a tar archive.
  yield Buffer.alloc(BLOCK * 2)
}

function readString(block, offset, length) {
  const raw = block.subarray(offset, offset + length)
  const end = raw.indexOf(0)
  const trimmed = end === -1 ? raw : raw.subarray(0, end)
  return trimmed.toString('utf8')
}

function isZeroBlock(block) {
  for (const byte of block) if (byte !== 0) return false
  return true
}

/** Parse and validate one header block. */
export function parseTarHeader(block) {
  const stored = Number.parseInt(readString(block, 148, 8).trim() || '0', 8)
  let checksum = 0
  for (let index = 0; index < BLOCK; index += 1) {
    checksum += index >= 148 && index < 156 ? 0x20 : block[index]
  }
  if (!Number.isFinite(stored) || stored !== checksum) {
    throw new Error('tar: header checksum mismatch (the archive is corrupt or truncated)')
  }

  const name = readString(block, 0, 100)
  const prefix = readString(block, 345, 155)
  const fullName = prefix === '' ? name : `${prefix}/${name}`
  if (fullName === '') throw new Error('tar: entry without a name')

  const size = Number.parseInt(readString(block, 124, 12).trim() || '0', 8)
  if (!Number.isFinite(size) || size < 0) throw new Error(`tar: invalid size for ${fullName}`)

  const type = String.fromCharCode(block[156] || 0x30)
  return { name: fullName, size, type }
}

/** Resolve an archive entry inside `root`, rejecting traversal and absolute paths. */
export function safeTarget(root, entryName) {
  const normalized = entryName.replace(/\\/gu, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) {
    throw new Error(`tar: absolute path in archive: ${entryName}`)
  }
  if (normalized.split('/').includes('..')) {
    throw new Error(`tar: path traversal in archive: ${entryName}`)
  }
  const target = path.resolve(root, normalized)
  const relative = path.relative(root, target)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`tar: entry escapes the extraction root: ${entryName}`)
  }
  return target
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()))
  })
}

function closeStream(stream) {
  return new Promise((resolve, reject) => {
    stream.end((error) => (error ? reject(error) : resolve()))
  })
}

/**
 * Stream a gzip-compressed tar archive into `destRoot`.
 *
 * @param {object} options
 * @param {import('node:stream').Readable} options.source compressed archive
 * @param {string} options.destRoot extraction root; created when missing
 * @param {number} [options.maxBytes] uncompressed payload budget
 * @param {number} [options.maxFiles] entry budget
 * @param {AbortSignal} [options.signal]
 */
export async function extractTarGz({ source, destRoot, maxBytes = 4 * 1024 ** 3, maxFiles = 50000, signal }) {
  const root = path.resolve(destRoot)
  await fsp.mkdir(root, { recursive: true })

  const input = source.pipe(zlib.createGunzip())
  let buffer = Buffer.alloc(0)
  let state = 'header'
  let sink = null
  let remaining = 0
  let padding = 0
  let entrySize = 0
  let files = 0
  let total = 0
  let finished = false
  let sawEntry = false

  try {
    for await (const chunk of input) {
      if (signal?.aborted) throw new Error('portable: import cancelled')
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])

      for (;;) {
        if (state === 'header') {
          if (buffer.length < BLOCK) break
          const block = buffer.subarray(0, BLOCK)
          buffer = buffer.subarray(BLOCK)
          if (isZeroBlock(block)) {
            finished = true
            buffer = Buffer.alloc(0)
            break
          }
          const header = parseTarHeader(block)
          sawEntry = true
          const target = safeTarget(root, header.name)

          if (header.type === '5') {
            await fsp.mkdir(target, { recursive: true })
            state = 'header'
            continue
          }
          if (header.type !== '0' && header.type !== '\0') {
            throw new Error(`tar: unsupported entry type ${JSON.stringify(header.type)} for ${header.name}`)
          }
          if (header.size > maxBytes - total) throw new Error('tar: archive exceeds the uncompressed size limit')
          total += header.size
          files += 1
          if (files > maxFiles) throw new Error('tar: archive contains too many files')

          await fsp.mkdir(path.dirname(target), { recursive: true })
          sink = createWriteStream(target, { flags: 'wx', mode: 0o644 })
          remaining = header.size
          entrySize = header.size
          state = 'body'
          continue
        }

        if (state === 'body') {
          if (remaining === 0) {
            await closeStream(sink)
            sink = null
            padding = paddingFor(entrySize)
            state = 'padding'
            continue
          }
          if (buffer.length === 0) break
          const take = Math.min(remaining, buffer.length)
          await writeChunk(sink, buffer.subarray(0, take))
          buffer = buffer.subarray(take)
          remaining -= take
          continue
        }

        if (state === 'padding') {
          if (padding === 0) {
            state = 'header'
            continue
          }
          if (buffer.length === 0) break
          const take = Math.min(padding, buffer.length)
          buffer = buffer.subarray(take)
          padding -= take
          continue
        }

        break
      }

      if (finished) break
    }
  } finally {
    if (sink !== null) {
      sink.destroy()
    }
  }

  if (!finished) throw new Error('tar: archive is truncated')
  if (!sawEntry) throw new Error('tar: archive is empty')
  return { files, bytes: total }
}
