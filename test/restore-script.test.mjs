import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { windowsRestoreScript } from '../lib/home.js'

const windowsOnly = process.platform === 'win32' ? test : test.skip

async function runScript(root, options) {
  const scriptPath = path.join(root, `restore-${Date.now()}.ps1`)
  await writeFile(scriptPath, windowsRestoreScript(options), 'utf8')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    encoding: 'utf8',
    timeout: 60000,
  })
  return result
}

windowsOnly('restore script swaps the home and keeps the previous one as a backup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dshp-restore-'))
  const home = path.join(root, '.dsh')
  const staging = path.join(root, 'staging')
  const backup = path.join(root, '.dsh.before-test')
  const log = path.join(root, 'restore.log')

  try {
    await mkdir(home, { recursive: true })
    await writeFile(path.join(home, 'value.txt'), 'old')
    await mkdir(path.join(staging, 'home'), { recursive: true })
    await writeFile(path.join(staging, 'home', 'value.txt'), 'new')

    const result = await runScript(root, { home, staging, backup, log, launch: null })
    assert.equal(result.status, 0, result.stderr)

    assert.equal(await readFile(path.join(home, 'value.txt'), 'utf8'), 'new')
    assert.equal(await readFile(path.join(backup, 'value.txt'), 'utf8'), 'old')
    const logText = await readFile(log, 'utf8')
    assert.match(logText, /home restored/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

windowsOnly('restore script rolls the previous home back when the staged home is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dshp-restore-fail-'))
  const home = path.join(root, '.dsh')
  const staging = path.join(root, 'staging')
  const backup = path.join(root, '.dsh.before-test')
  const log = path.join(root, 'restore.log')

  try {
    await mkdir(home, { recursive: true })
    await writeFile(path.join(home, 'value.txt'), 'old')
    await mkdir(staging, { recursive: true })

    const result = await runScript(root, { home, staging, backup, log, launch: null })
    assert.notEqual(result.status, 0)

    assert.equal(await readFile(path.join(home, 'value.txt'), 'utf8'), 'old')
    const logText = await readFile(log, 'utf8')
    assert.match(logText, /restore failed/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
