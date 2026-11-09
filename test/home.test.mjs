import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildManifest,
  inspectSessions,
  planImport,
  readWorkspaces,
  resolveHome,
  resolveStagingRoot,
  scanHome,
  windowsRestoreScript,
} from '../lib/home.js'

async function fakeHome() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dshp-home-'))
  const home = path.join(root, '.dsh')
  await mkdir(path.join(home, 'sessions', '--C-dev-goldbet--', 'session-1'), { recursive: true })
  await writeFile(path.join(home, 'sessions', '--C-dev-goldbet--', 'session-1', 'session.v4.jsonl.zstd'), 'log')
  await mkdir(path.join(home, 'sessions', '--C-dev-zeppelin--', 'session-2'), { recursive: true })
  await writeFile(path.join(home, 'sessions', '--C-dev-zeppelin--', 'session-2', 'session.v4.jsonl.zstd'), 'log')
  await mkdir(path.join(home, 'storages'), { recursive: true })
  await writeFile(path.join(home, 'storages', 'workspace.json'), JSON.stringify({
    tables: {
      workspaces: {
        one: { title: 'goldbet', path: 'C:\\dev\\goldbet' },
        two: { title: 'zeppelin', path: 'C:\\dev\\zeppelin' },
      },
    },
  }))
  await writeFile(path.join(home, '.credentials.yaml'), 'secret')
  await writeFile(path.join(home, '.env'), 'HTTPS_PROXY=http://127.0.0.1:2080')
  await writeFile(path.join(home, 'AGENTS.md'), '# rules')
  await mkdir(path.join(home, 'dsh-runtimes', 'node'), { recursive: true })
  await writeFile(path.join(home, 'dsh-runtimes', 'node', 'node.exe'), 'binary')
  await mkdir(path.join(home, 'cache', 'attachments'), { recursive: true })
  await writeFile(path.join(home, 'cache', 'attachments', 'x'), 'cache')
  await writeFile(path.join(home, 'session.lock'), 'lock')
  return { root, home }
}

test('resolveHome honours DSH_HOME and staging stays next to the home', () => {
  assert.equal(resolveHome({ DSH_HOME: 'C:\\x\\.dsh' }, 'C:\\Users\\u'), path.resolve('C:\\x\\.dsh'))
  assert.equal(resolveHome({}, 'C:\\Users\\u'), path.resolve('C:\\Users\\u', '.dsh'))
  assert.equal(resolveStagingRoot('C:\\Users\\u\\.dsh'), path.join('C:\\Users\\u', '.dsh-portable'))
})

test('scanHome skips runtimes, cache, locks and credentials when asked', async () => {
  const { root, home } = await fakeHome()
  try {
    const withoutSecrets = await scanHome(home, { includeCredentials: false, includeRuntimes: false })
    const names = withoutSecrets.entries.map((entry) => entry.rel)
    assert.ok(names.includes('AGENTS.md'))
    assert.ok(names.includes('sessions/--C-dev-goldbet--/session-1/session.v4.jsonl.zstd'))
    assert.ok(!names.some((name) => name.startsWith('dsh-runtimes')))
    assert.ok(!names.some((name) => name.startsWith('cache')))
    assert.ok(!names.includes('.credentials.yaml'))
    assert.ok(!names.includes('session.lock'))

    const withSecrets = await scanHome(home, { includeCredentials: true, includeRuntimes: true })
    const all = withSecrets.entries.map((entry) => entry.rel)
    assert.ok(all.includes('.credentials.yaml'))
    assert.ok(all.includes('dsh-runtimes/node/node.exe'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('inspectSessions counts logs and format generations', async () => {
  const entries = [
    { rel: 'sessions/a/session.v4.jsonl.zstd', dir: false },
    { rel: 'sessions/b/session.v4.jsonl.zstd', dir: false },
    { rel: 'sessions/c/session.v3.jsonl', dir: false },
    { rel: 'sessions/d', dir: true },
  ]
  const result = inspectSessions(entries)
  assert.equal(result.sessions, 3)
  assert.deepEqual(result.sessionFormats, ['v3', 'v4'])
})

test('readWorkspaces reads durable workspace records', async () => {
  const { root, home } = await fakeHome()
  try {
    const workspaces = await readWorkspaces(home)
    assert.equal(workspaces.length, 2)
    assert.equal(workspaces[0].title, 'goldbet')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('buildManifest records counts, includes and session formats', async () => {
  const { root, home } = await fakeHome()
  try {
    const scan = await scanHome(home, { includeCredentials: true, includeRuntimes: false })
    const manifest = await buildManifest({
      home,
      scan,
      workspaces: await readWorkspaces(home),
      version: '44.7.0',
      includeCredentials: true,
      includeRuntimes: false,
    })
    assert.equal(manifest.format, 'dsh-portable/1')
    assert.equal(manifest.app.version, '44.7.0')
    assert.equal(manifest.counts.sessions, 2)
    assert.equal(manifest.counts.workspaces, 2)
    assert.equal(manifest.includes.credentials, true)
    assert.equal(manifest.includes.env, true)
    assert.deepEqual(manifest.sessionFormats, ['v4'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('planImport reports missing projects, version and disk problems', () => {
  const manifest = {
    format: 'dsh-portable/1',
    createdAt: new Date().toISOString(),
    app: { version: '42.0.0', platform: 'win32' },
    source: { home: 'C:\\Users\\other\\.dsh' },
    includes: { credentials: true, env: true, runtimes: false },
    counts: { files: 10, bytes: 1_000_000 },
    workspaces: [{ title: 'a', path: 'C:\\missing-a' }, { title: 'b', path: 'C:\\missing-b' }],
  }
  const plan = planImport({
    manifest,
    home: 'C:\\Users\\me\\.dsh',
    version: '44.7.0',
    freeBytes: 10_000,
    workspaceExists: () => false,
  })

  const codes = plan.warnings.map((warning) => warning.code)
  assert.ok(codes.includes('workspaces-missing'))
  assert.ok(codes.includes('version-mismatch'))
  assert.ok(codes.includes('disk-space'))
  assert.ok(codes.includes('credentials-included'))
  assert.equal(plan.canApply, false)
  assert.equal(plan.missingWorkspaces.length, 2)
})

test('restore script quotes paths and waits for the home to be released', () => {
  const script = windowsRestoreScript({
    home: "C:\\Users\\o'brien\\.dsh",
    staging: 'C:\\tmp\\staging',
    backup: 'C:\\tmp\\backup',
    log: 'C:\\tmp\\log.txt',
    launch: 'C:\\app.exe',
  })
  assert.match(script, /Rename-Item -LiteralPath \$dshHome/u)
  assert.match(script, /'C:\\Users\\o''brien\\\.dsh'/u)
  assert.match(script, /Move-Item -LiteralPath \(Join-Path \$staging 'home'\)/u)
  assert.match(script, /Start-Process -FilePath \$launch/u)
  assert.match(script, /timed out waiting for DSH to exit/u)
})
