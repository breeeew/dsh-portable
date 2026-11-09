/**
 * Home-directory facts for the portable archive: what to include, the
 * manifest written next to it, the import plan shown before anything is
 * replaced, and the restore script that performs the cold swap.
 */
import { existsSync } from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Archive format identifier; bump when the on-disk shape changes. */
export const FORMAT = 'dsh-portable/1'

/** Session-log generations this plugin knows how to hand to a current DSH. */
export const SUPPORTED_SESSION_FORMATS = new Set(['v0', 'v1', 'v2', 'v3', 'v4'])

/** Uncompressed payload limits applied on both export and import. */
export const LIMITS = {
  maxBytes: 4 * 1024 ** 3,
  maxFiles: 50000,
  maxArchiveBytes: 2 * 1024 ** 3,
}

export function resolveHome(env = process.env, homedir = os.homedir()) {
  const fromEnv = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return path.resolve(fromEnv !== '' ? fromEnv : path.join(homedir, '.dsh'))
}

/**
 * Staging lives next to the home, never inside it: an archive being unpacked
 * must not become part of the next export, and the swap only touches `home`.
 */
export function resolveStagingRoot(home) {
  return path.join(path.dirname(home), '.dsh-portable')
}

export function isValidStagingId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{5,80}$/u.test(id)
}

export function newStagingId(now = Date.now(), random = Math.random) {
  const stamp = now.toString(36)
  const suffix = Math.floor(random() * 0xffffff).toString(16).padStart(6, '0')
  return `${stamp}-${suffix}`
}

function skipEntry(rel, { includeCredentials, includeRuntimes }) {
  const parts = rel.split('/')
  if (parts[0] === 'dsh-runtimes' && !includeRuntimes) return true
  if (parts[0] === 'cache') return true
  if (parts[0] === '.git') return true
  if (parts.includes('.git')) return true
  if (rel === '.credentials.yaml' && !includeCredentials) return true
  if (rel.endsWith('.lock')) return true
  if (rel.includes('/.plugin-manager/logs/') || rel.endsWith('/.plugin-manager/logs')) return true
  return false
}

/**
 * Walk the harness home and return the entries a portable archive carries.
 * Symlinks and special files are skipped deliberately: the archive stores
 * only real content, so restoring it cannot create links on another machine.
 */
export async function scanHome(home, options = {}) {
  const settings = {
    includeCredentials: options.includeCredentials !== false,
    includeRuntimes: options.includeRuntimes === true,
  }
  const entries = []
  let totalBytes = 0

  async function walk(directory, relative) {
    let dirents
    try {
      dirents = await fsp.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    dirents.sort((left, right) => left.name.localeCompare(right.name))

    for (const dirent of dirents) {
      const childRelative = relative === '' ? dirent.name : `${relative}/${dirent.name}`
      if (skipEntry(childRelative, settings)) continue
      const absolute = path.join(directory, dirent.name)

      if (dirent.isDirectory()) {
        entries.push({ rel: childRelative, abs: absolute, dir: true })
        await walk(absolute, childRelative)
        continue
      }
      if (!dirent.isFile()) continue

      const stat = await fsp.stat(absolute)
      entries.push({ rel: childRelative, abs: absolute, dir: false, size: stat.size })
      totalBytes += stat.size
      if (entries.length > LIMITS.maxFiles) {
        throw new Error(`too many files in the harness home (limit ${LIMITS.maxFiles})`)
      }
      if (totalBytes > LIMITS.maxBytes) {
        throw new Error('the harness home exceeds the archive size limit')
      }
    }
  }

  await walk(home, '')
  return { entries, totalBytes }
}

/** Session log files and the format generations an archive contains. */
export function inspectSessions(entries) {
  const formats = new Set()
  let sessions = 0
  for (const entry of entries) {
    if (entry.dir) continue
    const match = /(?:^|\/)sessions\/.+\/session\.(?:v(\d+)\.)?jsonl(?:\.zstd)?$/u.exec(entry.rel)
    if (match === null) continue
    sessions += 1
    formats.add(match[1] === undefined ? 'v0' : `v${match[1]}`)
  }
  return { sessions, sessionFormats: [...formats].sort() }
}

/** Workspace records from the durable workspace store. */
export async function readWorkspaces(home) {
  const file = path.join(home, 'storages', 'workspace.json')
  let parsed
  try {
    parsed = JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return []
  }
  const table = parsed?.tables?.workspaces
  if (table === null || typeof table !== 'object') return []
  return Object.values(table)
    .map((workspace) => ({
      title: typeof workspace?.title === 'string' ? workspace.title : '',
      path: typeof workspace?.path === 'string' ? workspace.path : '',
    }))
    .filter((workspace) => workspace.path !== '')
}

/** Whether the home carries a proxy-bearing `.env` file. */
export async function hasEnvFile(home) {
  try {
    const stat = await fsp.stat(path.join(home, '.env'))
    return stat.isFile()
  } catch {
    return false
  }
}

export async function buildManifest({ home, scan, workspaces, version, includeCredentials, includeRuntimes }) {
  const { sessions, sessionFormats } = inspectSessions(scan.entries)
  return {
    format: FORMAT,
    createdAt: new Date().toISOString(),
    app: { version: version ?? null, platform: process.platform, arch: process.arch },
    source: {
      hostname: os.hostname(),
      username: safeUsername(),
      home,
    },
    includes: {
      credentials: includeCredentials,
      runtimes: includeRuntimes,
      env: await hasEnvFile(home),
    },
    counts: {
      files: scan.entries.filter((entry) => !entry.dir).length,
      bytes: scan.totalBytes,
      sessions,
      workspaces: workspaces.length,
    },
    sessionFormats,
    workspaces,
  }
}

function safeUsername() {
  try {
    return os.userInfo().username
  } catch {
    return null
  }
}

function majorOf(version) {
  const match = /^(\d+)\./u.exec(String(version ?? ''))
  return match === null ? null : Number(match[1])
}

/** Free space on the volume that holds the home. */
export async function freeSpaceFor(home) {
  try {
    const stats = await fsp.statfs(path.dirname(home))
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}

/**
 * Compare an imported manifest with this machine and produce localized-by-code
 * warnings. The browser owns the wording; the host owns the facts.
 */
export function planImport({ manifest, home, version, freeBytes, workspaceExists }) {
  const warnings = []
  const exists = workspaceExists ?? ((candidate) => existsSync(candidate))

  if (manifest?.format !== FORMAT) {
    warnings.push({ code: 'format-unsupported', level: 'danger', params: { format: String(manifest?.format ?? '') } })
  }

  const formats = Array.isArray(manifest?.sessionFormats) ? manifest.sessionFormats.filter((value) => typeof value === 'string') : []
  const unsupportedFormats = formats.filter((value) => !SUPPORTED_SESSION_FORMATS.has(value))
  if (unsupportedFormats.length > 0) {
    warnings.push({ code: 'session-format-newer', level: 'danger', params: { formats: unsupportedFormats } })
  }

  if (manifest?.includes?.credentials === true) {
    warnings.push({ code: 'credentials-included', level: 'warn', params: {} })
  }
  if (manifest?.includes?.env === true) {
    warnings.push({ code: 'env-included', level: 'warn', params: {} })
  }
  if (manifest?.includes?.runtimes !== true) {
    warnings.push({ code: 'runtimes-excluded', level: 'info', params: {} })
  }

  const missing = (manifest?.workspaces ?? []).filter((workspace) => !exists(workspace.path))
  if (missing.length > 0) {
    warnings.push({
      code: 'workspaces-missing',
      level: 'warn',
      params: { count: missing.length, sample: missing.slice(0, 3).map((workspace) => workspace.path) },
    })
  }

  const sourceMajor = majorOf(manifest?.app?.version)
  const currentMajor = majorOf(version)
  if (sourceMajor !== null && currentMajor !== null && sourceMajor !== currentMajor) {
    warnings.push({
      code: 'version-mismatch',
      level: 'warn',
      params: { from: manifest.app.version, to: version },
    })
  }

  if (manifest?.app?.platform !== undefined && manifest.app.platform !== process.platform) {
    warnings.push({ code: 'platform-mismatch', level: 'warn', params: { from: manifest.app.platform, to: process.platform } })
  }

  if (manifest?.source?.home !== undefined && path.resolve(String(manifest.source.home)) === path.resolve(home)) {
    warnings.push({ code: 'same-home', level: 'info', params: {} })
  }

  const bytes = Number(manifest?.counts?.bytes ?? 0)
  if (freeBytes !== null && Number.isFinite(bytes) && bytes > 0 && bytes * 2 > freeBytes) {
    warnings.push({ code: 'disk-space', level: 'danger', params: { required: bytes * 2, free: freeBytes } })
  }

  const canApply = !warnings.some((warning) => warning.level === 'danger')
  return { canApply, warnings, missingWorkspaces: missing.map((workspace) => workspace.path) }
}

/** Name of the directory that keeps the replaced home. */
export function backupPathFor(home, date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/gu, '-').replace('T', '_').slice(0, 19)
  return `${home}.before-${stamp}`
}

/** PowerShell script that waits for DSH to exit, swaps the home and relaunches. */
export function windowsRestoreScript({ home, staging, backup, log, launch }) {
  const quote = (value) => `'${String(value ?? '').replace(/'/gu, "''")}'`
  return `$ErrorActionPreference = 'Stop'
$dshHome = ${quote(home)}
$staging = ${quote(staging)}
$backup = ${quote(backup)}
$log = ${quote(log)}
$launch = ${quote(launch ?? '')}

function Write-RestoreLog([string]$message) {
  try { Add-Content -LiteralPath $log -Value ((Get-Date).ToString('o') + ' ' + $message) } catch { }
}

Write-RestoreLog 'restore started'
$moved = $false
for ($i = 0; $i -lt 3600; $i++) {
  if (-not (Test-Path -LiteralPath $dshHome)) { $moved = $true; break }
  try {
    Rename-Item -LiteralPath $dshHome -NewName (Split-Path -Leaf $backup) -ErrorAction Stop
    $moved = $true
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $moved) {
  Write-RestoreLog 'timed out waiting for DSH to exit; nothing was changed'
  exit 2
}
Write-RestoreLog ('previous home moved to ' + $backup)

try {
  Move-Item -LiteralPath (Join-Path $staging 'home') -Destination $dshHome -ErrorAction Stop
  Write-RestoreLog 'home restored'
} catch {
  Write-RestoreLog ('restore failed: ' + $_.Exception.Message)
  if (-not (Test-Path -LiteralPath $dshHome)) {
    try { Rename-Item -LiteralPath $backup -NewName (Split-Path -Leaf $dshHome) } catch { }
  }
  exit 3
}

if ($launch -ne '') {
  try {
    Start-Process -FilePath $launch
    Write-RestoreLog 'relaunched'
  } catch {
    Write-RestoreLog ('relaunch failed: ' + $_.Exception.Message)
  }
}
exit 0
`
}

/** POSIX equivalent of the restore script (macOS/Linux CLI installs). */
export function posixRestoreScript({ home, staging, backup, log, launch }) {
  const quote = (value) => `'${String(value ?? '').replace(/'/gu, `'\\''`)}'`
  return `#!/bin/sh
set -eu
home=${quote(home)}
staging=${quote(staging)}
backup=${quote(backup)}
log=${quote(log)}
launch=${quote(launch ?? '')}

log_line() {
  printf '%s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$log" 2>/dev/null || true
}

log_line 'restore started'
i=0
while [ -e "$home" ]; do
  if mv "$home" "$backup" 2>/dev/null; then break; fi
  i=$((i + 1))
  if [ "$i" -ge 3600 ]; then log_line 'timed out waiting for DSH to exit; nothing was changed'; exit 2; fi
  sleep 2
done
log_line "previous home moved to $backup"

if ! mv "$staging/home" "$home" 2>/dev/null; then
  log_line 'restore failed'
  [ -e "$home" ] || mv "$backup" "$home" 2>/dev/null || true
  exit 3
fi
log_line 'home restored'

if [ -n "$launch" ]; then
  "$launch" >/dev/null 2>&1 &
fi
exit 0
`
}
