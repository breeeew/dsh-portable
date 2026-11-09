import assert from 'node:assert/strict'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import test from 'node:test'

import { extractTarGz } from '../lib/archive.js'
import { createPortable } from '../lib/index.js'

async function fakeHome() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dshp-e2e-'))
  const home = path.join(root, '.dsh')
  await mkdir(path.join(home, 'sessions', '--C-dev-goldbet--', 'session-1'), { recursive: true })
  await writeFile(path.join(home, 'sessions', '--C-dev-goldbet--', 'session-1', 'session.v4.jsonl.zstd'), 'session-log')
  await mkdir(path.join(home, 'storages'), { recursive: true })
  await writeFile(path.join(home, 'storages', 'workspace.json'), JSON.stringify({
    tables: {
      workspaces: {
        one: { title: 'goldbet', path: path.join(root, 'projects', 'goldbet') },
      },
    },
  }))
  await writeFile(path.join(home, '.credentials.yaml'), 'token: secret')
  await writeFile(path.join(home, '.env'), 'HTTPS_PROXY=http://127.0.0.1:2080')
  await writeFile(path.join(home, 'AGENTS.md'), '# global rules')
  await mkdir(path.join(home, 'dsh-runtimes', 'node'), { recursive: true })
  await writeFile(path.join(home, 'dsh-runtimes', 'node', 'node.exe'), 'binary')
  return { root, home }
}

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

test('export -> import -> apply keeps the archive complete and the swap staged', async () => {
  const { root, home } = await fakeHome()
  const stagingRoot = path.join(root, '.dsh-portable')
  const spawned = []
  const service = createPortable({
    home,
    stagingRoot,
    detectVersion: async () => '44.7.0',
    relaunchPath: null,
    spawnRestore: async (script) => {
      spawned.push(script)
      return 4242
    },
  })

  try {
    const status = await (await service.status()).json()
    assert.equal(status.sessions, 1)
    assert.equal(status.workspaces.length, 1)

    const exported = await service.exportArchive(new Request('http://dsh.local/api/portable/export?credentials=1&runtimes=0'))
    assert.equal(exported.status, 200)
    assert.equal(exported.headers.get('content-type'), 'application/gzip')

    const archive = path.join(root, 'export.tar.gz')
    await pipeline(Readable.fromWeb(exported.body), createWriteStream(archive))

    const unpacked = path.join(root, 'unpacked')
    await extractTarGz({ source: createReadStream(archive), destRoot: unpacked })
    const manifest = JSON.parse(await readFile(path.join(unpacked, 'manifest.json'), 'utf8'))
    assert.equal(manifest.counts.sessions, 1)
    assert.equal(manifest.includes.credentials, true)
    assert.equal(manifest.includes.runtimes, false)
    assert.equal(await exists(path.join(unpacked, 'home', 'dsh-runtimes')), false)

    const importResponse = await service.importArchive(new Request('http://dsh.local/api/portable/import', {
      method: 'POST',
      body: createReadStream(archive),
      duplex: 'half',
      headers: { 'content-type': 'application/gzip' },
    }))
    const plan = await importResponse.json()
    assert.equal(importResponse.status, 200, JSON.stringify(plan))
    assert.equal(plan.manifest.counts.sessions, 1)
    assert.equal(plan.plan.canApply, true)
    assert.match(plan.staging, /^[a-z0-9-]+$/u)

    const applyResponse = await service.applyRestore({
      staging: plan.staging,
      importCredentials: false,
      importEnv: false,
      relaunch: false,
    })
    const applied = await applyResponse.json()
    assert.equal(applyResponse.status, 200, JSON.stringify(applied))
    assert.equal(applied.ok, true)
    assert.equal(spawned.length, 1)

    const stagedHome = path.join(stagingRoot, 'staging', plan.staging, 'home')
    assert.equal(await exists(path.join(stagedHome, '.credentials.yaml')), false)
    assert.equal(await exists(path.join(stagedHome, '.env')), false)
    assert.equal(await exists(path.join(stagedHome, 'AGENTS.md')), true)

    const script = await readFile(applied.script, 'utf8')
    assert.match(script, /restore started/u)
    assert.ok(script.includes(home))

    // The staged home is untouched until DSH exits: the live home must still
    // hold the original files.
    assert.equal(await readFile(path.join(home, 'AGENTS.md'), 'utf8'), '# global rules')

    const discarded = await (await service.discard({ staging: plan.staging })).json()
    assert.equal(discarded.ok, true)
    assert.equal(await exists(path.join(stagingRoot, 'staging', plan.staging)), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('export can leave credentials out', async () => {
  const { root, home } = await fakeHome()
  const service = createPortable({
    home,
    stagingRoot: path.join(root, '.dsh-portable'),
    detectVersion: async () => '44.7.0',
    relaunchPath: null,
    spawnRestore: async () => 1,
  })
  try {
    const exported = await service.exportArchive(new Request('http://dsh.local/api/portable/export?credentials=0'))
    const archive = path.join(root, 'export.tar.gz')
    await pipeline(Readable.fromWeb(exported.body), createWriteStream(archive))
    const unpacked = path.join(root, 'unpacked')
    await extractTarGz({ source: createReadStream(archive), destRoot: unpacked })
    const manifest = JSON.parse(await readFile(path.join(unpacked, 'manifest.json'), 'utf8'))
    assert.equal(manifest.includes.credentials, false)
    assert.equal(await exists(path.join(unpacked, 'home', '.credentials.yaml')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('import rejects an archive without a manifest', async () => {
  const { root, home } = await fakeHome()
  const service = createPortable({
    home,
    stagingRoot: path.join(root, '.dsh-portable'),
    detectVersion: async () => '44.7.0',
    relaunchPath: null,
    spawnRestore: async () => 1,
  })
  try {
    const { tarEntries } = await import('../lib/archive.js')
    const { createGzip } = await import('node:zlib')
    const archive = path.join(root, 'bad.tar.gz')
    await pipeline(
      Readable.from(tarEntries([
        { name: 'home/AGENTS.md', buffer: Buffer.from('# nope') },
      ])),
      createGzip(),
      createWriteStream(archive),
    )

    const response = await service.importArchive(new Request('http://dsh.local/api/portable/import', {
      method: 'POST',
      body: createReadStream(archive),
      duplex: 'half',
    }))
    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.match(payload.error, /manifest/u)

    const stagingEntries = await readdir(path.join(root, '.dsh-portable', 'staging')).catch(() => [])
    assert.deepEqual(stagingEntries, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
