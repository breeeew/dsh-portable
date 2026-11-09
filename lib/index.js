/**
 * Host half of dsh-portable.
 *
 * Two authenticated routes do the work:
 *   GET  /api/portable/export   -> streams a `.tar.gz` of the harness home
 *   POST /api/portable/import   -> streams an archive into staged storage and
 *                                  answers with a plan (nothing is replaced)
 *   POST /api/portable/apply    -> writes a restore script and starts it
 *                                  detached; the script waits for DSH to exit,
 *                                  swaps the home and relaunches
 *   POST /api/portable/discard  -> deletes one staging directory
 *
 * The import never touches live files: DSH holds session logs and storage
 * JSON open, so replacing the home in-process would either fail on Windows
 * or be overwritten on the next save. The cold swap keeps the archive honest
 * and gives the user a full backup of the replaced home.
 */
import { spawn } from 'node:child_process'
import { existsSync, createReadStream, createWriteStream } from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform, compose } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

import { extractTarGz, tarEntries } from './archive.js'
import {
  FORMAT,
  LIMITS,
  backupPathFor,
  buildManifest,
  freeSpaceFor,
  inspectSessions,
  isValidStagingId,
  newStagingId,
  planImport,
  posixRestoreScript,
  readWorkspaces,
  resolveHome,
  resolveStagingRoot,
  scanHome,
  windowsRestoreScript,
} from './home.js'

export const name = 'portable'
export const inject = ['connection']

const ROUTES = {
  status: '/api/portable/status',
  export: '/api/portable/export',
  import: '/api/portable/import',
  apply: '/api/portable/apply',
  discard: '/api/portable/discard',
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

let cachedVersion

async function defaultDetectVersion() {
  if (cachedVersion !== undefined) return cachedVersion
  cachedVersion = null

  const fromEnv = typeof process.env.DSH_VERSION === 'string' ? process.env.DSH_VERSION.trim() : ''
  if (fromEnv !== '') cachedVersion = fromEnv

  if (cachedVersion === null) {
    try {
      const boot = await import('@deepseek-ai/dsh-app-boot')
      if (typeof boot?.getDshRuntimeVersion === 'function') cachedVersion = boot.getDshRuntimeVersion()
    } catch {
      // The runtime table may not expose this package to third-party bundles.
    }
  }

  return cachedVersion
}

function defaultRelaunchPath() {
  if (process.platform !== 'win32') return null
  const local = process.env.LOCALAPPDATA
  if (!local) return null
  const executable = path.join(local, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe')
  return existsSync(executable) ? executable : null
}

function assertInside(root, target) {
  const relative = path.relative(root, target)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('portable: path escapes the staging root')
  }
}

function validateManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object') throw new Error('the archive has no manifest.json')
  if (manifest.format !== FORMAT) throw new Error(`unsupported archive format: ${String(manifest.format)}`)
  if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error('the archive manifest has no valid createdAt')
  }
  if (manifest.counts === null || typeof manifest.counts !== 'object') {
    throw new Error('the archive manifest has no counts')
  }
  if (!Array.isArray(manifest.workspaces)) {
    throw new Error('the archive manifest has no workspace list')
  }
}

/**
 * Build the service over explicit paths so tests can run it against a
 * temporary home without touching the real one.
 */
export function createPortable(overrides = {}) {
  const env = overrides.env ?? process.env
  const home = path.resolve(overrides.home ?? resolveHome(env))
  const stagingRoot = path.resolve(overrides.stagingRoot ?? resolveStagingRoot(home))
  const detectVersion = overrides.detectVersion ?? defaultDetectVersion
  const relaunchPath = overrides.relaunchPath !== undefined ? overrides.relaunchPath : defaultRelaunchPath()
  const spawnRestore = overrides.spawnRestore ?? spawnDetached

  async function status() {
    const version = await detectVersion()
    let sessions = 0
    try {
      const projects = await fsp.readdir(path.join(home, 'sessions'), { withFileTypes: true })
      for (const project of projects) {
        if (!project.isDirectory()) continue
        const entries = await fsp.readdir(path.join(home, 'sessions', project.name), { withFileTypes: true })
        sessions += entries.filter((entry) => entry.isDirectory()).length
      }
    } catch {
      sessions = 0
    }
    const workspaces = await readWorkspaces(home)
    let hasEnv = false
    try {
      hasEnv = (await fsp.stat(path.join(home, '.env'))).isFile()
    } catch {
      hasEnv = false
    }

    return json({
      home,
      stagingRoot,
      version,
      platform: process.platform,
      arch: process.arch,
      sessions,
      workspaces,
      hasEnv,
      pending: await listPending(),
    })
  }

  async function listPending() {
    const pending = []
    const directory = path.join(stagingRoot, 'staging')
    let entries
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true })
    } catch {
      return pending
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidStagingId(entry.name)) continue
      try {
        const plan = JSON.parse(await fsp.readFile(path.join(directory, entry.name, 'plan.json'), 'utf8'))
        pending.push({ staging: entry.name, createdAt: plan.createdAt ?? null, source: plan.manifest?.source ?? null })
      } catch {
        // A half-written staging is cleaned up by the next import.
      }
    }
    return pending
  }

  async function exportArchive(request) {
    const url = new URL(request.url)
    const includeCredentials = url.searchParams.get('credentials') !== '0'
    const includeRuntimes = url.searchParams.get('runtimes') === '1'

    const host = os.hostname().replace(/[^A-Za-z0-9._-]/gu, '_')
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19)
    const filename = `dsh-portable-${host}-${stamp}.tar.gz`

    if (request.method === 'HEAD') {
      // The browser probes the route before handing the URL to the download
      // manager, so a failing scan must not turn into a downloaded error page.
      return new Response(null, {
        headers: {
          'content-type': 'application/gzip',
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control': 'no-store',
        },
      })
    }

    const scan = await scanHome(home, { includeCredentials, includeRuntimes })
    const workspaces = await readWorkspaces(home)
    const version = await detectVersion()
    const manifest = await buildManifest({
      home,
      scan,
      workspaces,
      version,
      includeCredentials,
      includeRuntimes,
    })

    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
    const entries = [
      { name: 'manifest.json', buffer: manifestBuffer, mode: 0o644 },
      ...scan.entries.map((entry) => ({ name: `home/${entry.rel}`, abs: entry.abs })),
    ]

    const archive = compose(Readable.from(tarEntries(entries)), createGzip({ level: 6 }))

    return new Response(Readable.toWeb(archive), {
      headers: {
        'content-type': 'application/gzip',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    })
  }

  async function importArchive(request) {
    if (request.body === null) return json({ error: 'empty upload' }, 400)

    const staging = newStagingId()
    const directory = path.join(stagingRoot, 'staging', staging)
    await fsp.mkdir(directory, { recursive: true })

    try {
      let received = 0
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length
          if (received > LIMITS.maxArchiveBytes) {
            callback(new Error('the uploaded archive is too large'))
            return
          }
          callback(null, chunk)
        },
      })

      await pipeline(
        Readable.fromWeb(request.body),
        limiter,
        createWriteStream(path.join(directory, 'archive.tar.gz')),
      )

      const extracted = await extractTarGz({
        source: createReadStream(path.join(directory, 'archive.tar.gz')),
        destRoot: directory,
        maxBytes: LIMITS.maxBytes,
        maxFiles: LIMITS.maxFiles,
        signal: request.signal,
      })

      let manifest
      try {
        manifest = JSON.parse(await fsp.readFile(path.join(directory, 'manifest.json'), 'utf8'))
      } catch {
        throw new Error('the archive has no readable manifest.json')
      }
      validateManifest(manifest)

      const homeDirectory = path.join(directory, 'home')
      const stat = await fsp.stat(homeDirectory)
      if (!stat.isDirectory()) throw new Error('the archive has no home directory')

      const version = await detectVersion()
      const freeBytes = await freeSpaceFor(home)
      const plan = planImport({ manifest, home, version, freeBytes })
      const sessionInfo = inspectSessions(
        await listExtracted(homeDirectory),
      )

      const payload = {
        staging,
        createdAt: new Date().toISOString(),
        sizeBytes: received,
        manifest: {
          ...manifest,
          counts: { ...manifest.counts, sessions: sessionInfo.sessions },
          sessionFormats: sessionInfo.sessionFormats,
        },
        plan,
        files: extracted.files,
      }

      await fsp.writeFile(path.join(directory, 'plan.json'), JSON.stringify(payload, null, 2))
      await pruneStaging()
      return json(payload)
    } catch (error) {
      await fsp.rm(directory, { recursive: true, force: true }).catch(() => {})
      return json({ error: errorMessage(error) }, 400)
    }
  }

  async function listExtracted(homeDirectory) {
    const entries = []
    const walk = async (directory, relative) => {
      const dirents = await fsp.readdir(directory, { withFileTypes: true })
      for (const dirent of dirents) {
        const rel = relative === '' ? dirent.name : `${relative}/${dirent.name}`
        if (dirent.isDirectory()) {
          await walk(path.join(directory, dirent.name), rel)
        } else if (dirent.isFile()) {
          entries.push({ rel, abs: path.join(directory, dirent.name), dir: false })
        }
      }
    }
    await walk(homeDirectory, '')
    return entries
  }

  async function pruneStaging() {
    const directory = path.join(stagingRoot, 'staging')
    let entries
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const target = path.join(directory, entry.name)
      try {
        const stat = await fsp.stat(target)
        if (stat.mtimeMs < cutoff) await fsp.rm(target, { recursive: true, force: true })
      } catch {
        // Pruning is opportunistic.
      }
    }
  }

  async function applyRestore(body) {
    const staging = typeof body?.staging === 'string' ? body.staging : ''
    if (!isValidStagingId(staging)) return json({ error: 'invalid staging id' }, 400)

    const directory = path.resolve(stagingRoot, 'staging', staging)
    assertInside(path.resolve(stagingRoot, 'staging'), directory)

    let payload
    try {
      payload = JSON.parse(await fsp.readFile(path.join(directory, 'plan.json'), 'utf8'))
    } catch {
      return json({ error: 'the staged import is missing or already applied' }, 404)
    }
    if (payload?.plan?.canApply !== true) {
      return json({ error: 'the staged import has blocking warnings; fix them and import again' }, 409)
    }

    const homeDirectory = path.join(directory, 'home')
    const stat = await fsp.stat(homeDirectory).catch(() => null)
    if (stat === null || !stat.isDirectory()) return json({ error: 'the staged home is missing' }, 409)

    const importCredentials = body?.importCredentials !== false
    const importEnv = body?.importEnv === true
    const relaunch = body?.relaunch !== false

    if (!importCredentials) await fsp.rm(path.join(homeDirectory, '.credentials.yaml'), { force: true })
    if (!importEnv) await fsp.rm(path.join(homeDirectory, '.env'), { force: true })

    const backup = backupPathFor(home)
    const logs = path.join(stagingRoot, 'logs')
    await fsp.mkdir(logs, { recursive: true })
    const log = path.join(logs, `restore-${staging}.log`)
    const extension = process.platform === 'win32' ? 'ps1' : 'sh'
    const script = path.join(stagingRoot, `restore-${staging}.${extension}`)
    const launch = relaunch ? relaunchPath : null

    const scriptBody = process.platform === 'win32'
      ? windowsRestoreScript({ home, staging: directory, backup, log, launch })
      : posixRestoreScript({ home, staging: directory, backup, log, launch })
    await fsp.writeFile(script, scriptBody, 'utf8')

    try {
      await spawnRestore(script, stagingRoot)
    } catch (error) {
      return json({ error: `could not start the restore helper: ${errorMessage(error)}` }, 500)
    }

    return json({
      ok: true,
      staging,
      home,
      backup,
      script,
      log,
      relaunch: launch,
      message: 'Close DSH completely (including the tray icon); the restore continues on its own.',
    })
  }

  async function discard(body) {
    const staging = typeof body?.staging === 'string' ? body.staging : ''
    if (!isValidStagingId(staging)) return json({ error: 'invalid staging id' }, 400)
    const directory = path.resolve(stagingRoot, 'staging', staging)
    assertInside(path.resolve(stagingRoot, 'staging'), directory)
    await fsp.rm(directory, { recursive: true, force: true })
    return json({ ok: true })
  }

  return { home, stagingRoot, status, exportArchive, importArchive, applyRestore, discard }
}

function spawnDetached(script, cwd) {
  const options = { detached: true, stdio: 'ignore', cwd, windowsHide: true }
  const child = process.platform === 'win32'
    ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], options)
    : spawn('sh', [script], options)
  child.unref()
  return Promise.resolve(child.pid)
}

/**
 * Register the routes on the Connection fetch handler. Every route is
 * authenticated by the host carrier; none of them accepts a path outside
 * the harness home or the staging root.
 */
export function apply(ctx) {
  const service = createPortable()

  const register = (route, methods, requestBody, handler) => {
    ctx.effect(() => ctx.connection.fetch.register({
      path: route,
      methods,
      requestBody,
      fetch: handler,
    }), `dsh-portable: ${route}`)
  }

  register(ROUTES.status, ['GET'], 'buffered', async () => {
    try {
      return await service.status()
    } catch (error) {
      return json({ error: errorMessage(error) }, 500)
    }
  })

  register(ROUTES.export, ['GET', 'HEAD'], 'buffered', async (request) => {
    try {
      return await service.exportArchive(request)
    } catch (error) {
      return json({ error: errorMessage(error) }, 500)
    }
  })

  register(ROUTES.import, ['POST'], 'streaming', async (request) => {
    try {
      return await service.importArchive(request)
    } catch (error) {
      return json({ error: errorMessage(error) }, 500)
    }
  })

  register(ROUTES.apply, ['POST'], 'buffered', async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'invalid JSON body' }, 400)
    }
    try {
      return await service.applyRestore(body)
    } catch (error) {
      return json({ error: errorMessage(error) }, 500)
    }
  })

  register(ROUTES.discard, ['POST'], 'buffered', async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'invalid JSON body' }, 400)
    }
    try {
      return await service.discard(body)
    } catch (error) {
      return json({ error: errorMessage(error) }, 500)
    }
  })
}

export const __test = { createPortable, validateManifest }
