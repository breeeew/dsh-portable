import assert from 'node:assert/strict'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import test from 'node:test'
import { createGzip } from 'node:zlib'

import { extractTarGz, tarEntries, tarHeader } from '../lib/archive.js'

async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writeArchive(file, entries) {
  await pipeline(Readable.from(tarEntries(entries)), createGzip(), createWriteStream(file))
}

test('tar roundtrip preserves content, unicode names and long paths', async () => {
  const root = await tempDir('dshp-tar-')
  const source = path.join(root, 'source')
  const target = path.join(root, 'target')
  const longName = `${'x'.repeat(60)}/${'y'.repeat(60)}.txt`

  await mkdir(path.join(source, 'nested', 'deep'), { recursive: true })
  await writeFile(path.join(source, 'nested', 'hello.txt'), 'hello world')
  await writeFile(path.join(source, 'nested', 'deep', 'привет.txt'), 'кириллица')
  await writeFile(path.join(source, 'empty.bin'), Buffer.alloc(0))
  await mkdir(path.dirname(path.join(source, longName)), { recursive: true })
  await writeFile(path.join(source, longName), 'long path')
  await writeFile(path.join(source, 'payload.bin'), Buffer.alloc(4096, 7))

  try {
    const entries = [
      { name: 'manifest.json', buffer: Buffer.from('{"format":"dsh-portable/1"}') },
      ...[
        'nested',
        'nested/hello.txt',
        'nested/deep',
        'nested/deep/привет.txt',
        'empty.bin',
        'payload.bin',
        longName.split('/')[0],
        longName,
      ].map((rel) => ({ name: `home/${rel}`, abs: path.join(source, rel) })),
    ]

    const archive = path.join(root, 'archive.tar.gz')
    await writeArchive(archive, entries)
    const result = await extractTarGz({ source: createReadStream(archive), destRoot: target })

    assert.equal(result.files, 6)
    assert.equal((await readFile(path.join(target, 'manifest.json'), 'utf8')), '{"format":"dsh-portable/1"}')
    assert.equal(await readFile(path.join(target, 'home', 'nested', 'hello.txt'), 'utf8'), 'hello world')
    assert.equal(await readFile(path.join(target, 'home', 'nested', 'deep', 'привет.txt'), 'utf8'), 'кириллица')
    assert.equal((await readFile(path.join(target, 'home', 'payload.bin'))).length, 4096)
    assert.equal(await readFile(path.join(target, 'home', longName), 'utf8'), 'long path')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('extraction rejects path traversal', async () => {
  const root = await tempDir('dshp-evil-')
  try {
    const archive = path.join(root, 'evil.tar.gz')
    const payload = Buffer.concat([
      tarHeader({ name: '../evil.txt', size: 0 }),
      Buffer.alloc(1024),
    ])
    await pipeline(Readable.from([payload]), createGzip(), createWriteStream(archive))

    await assert.rejects(
      extractTarGz({ source: createReadStream(archive), destRoot: path.join(root, 'out') }),
      /path traversal|escapes/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('extraction rejects a corrupt checksum', async () => {
  const root = await tempDir('dshp-corrupt-')
  try {
    const header = tarHeader({ name: 'home/file.txt', size: 0 })
    header[10] ^= 0xff
    const archive = path.join(root, 'corrupt.tar.gz')
    await pipeline(Readable.from([Buffer.concat([header, Buffer.alloc(1024)])]), createGzip(), createWriteStream(archive))

    await assert.rejects(
      extractTarGz({ source: createReadStream(archive), destRoot: path.join(root, 'out') }),
      /checksum/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('extraction rejects a truncated archive', async () => {
  const root = await tempDir('dshp-trunc-')
  try {
    const archive = path.join(root, 'trunc.tar.gz')
    const header = tarHeader({ name: 'home/file.txt', size: 100 })
    await pipeline(Readable.from([Buffer.concat([header, Buffer.from('short')])]), createGzip(), createWriteStream(archive))

    await assert.rejects(
      extractTarGz({ source: createReadStream(archive), destRoot: path.join(root, 'out') }),
      /truncated|checksum/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
