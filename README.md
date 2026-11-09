# dsh-portable

A DeepSeek Harness plugin that moves a complete DSH installation to another computer:
settings, session history, attachments, scheduled tasks, project list and permissions —
in one archive, with a **safe cold restore** instead of rewriting live files.

[Русская версия](README.ru.md)

```
Settings → Portable
  [ Export ]  download dsh-portable-<host>-<date>.tar.gz
  [ Import ]  choose an archive → review the plan → restore
```

## Why an import needs a restart

DSH keeps session logs, `storages/*.json` and the profile open for writing. Replacing
the harness home from inside the running process either fails on Windows (open handles
block the directory rename) or is overwritten by the next save. The plugin therefore
never swaps anything live:

1. the archive is uploaded and unpacked into a staging directory next to the home
   (`<home-parent>/.dsh-portable/staging/<id>`);
2. the host compares it with the current machine and returns a plan with warnings;
3. on **Restore**, the plugin writes a small PowerShell (`restore-<id>.ps1`) or POSIX
   (`restore-<id>.sh`) helper and starts it detached;
4. the helper waits until DSH exits, renames the current home to
   `<home>.before-<timestamp>`, moves the staged home into place and, on Windows,
   starts DSH again;
5. if anything fails after the rename, the helper moves the backup back.

Nothing is deleted: the previous home stays next to the new one.

## Install

Requires DSH `0.2.2-rc.1` or newer, `git` and `pnpm` for the bundle installation.

From the DSH UI: **Settings → Plugins → install** and pass the spec

```
github:breeeew/dsh-portable
```

or from a terminal:

```powershell
dsh plugin --profile desktop add github:breeeew/dsh-portable
```

Restart DSH once after installation; the **Portable** section then appears in Settings.

To uninstall, remove the bundle in **Settings → Plugins**. Uninstalling does not touch
any archive or backup.

## What goes into the archive

Everything under the harness home (`%USERPROFILE%\.dsh` on Windows, `~/.dsh` elsewhere),
recursively, except:

| Excluded | Why |
|---|---|
| `dsh-runtimes/` | downloaded Python/Node runtime, ~250 MB; can be included with a checkbox |
| `cache/` | rebuildable caches |
| `*.lock` | transient lock files |
| `profiles/*/.plugin-manager/logs/` | installation logs |
| `.git/` | repository metadata if the home is versioned |

Optional:

| Option | Default | Meaning |
|---|---|---|
| Access credentials (`.credentials.yaml`) | included | without them the new machine asks you to sign in again |
| Python/Node runtime | excluded | include only when the new machine has no network on first launch |

The archive is a plain `tar.gz` with a `manifest.json` at the root:

```json
{
  "format": "dsh-portable/1",
  "createdAt": "2026-11-09T14:40:19.363Z",
  "app": { "version": "0.2.2-rc.1", "platform": "win32", "arch": "x64" },
  "source": { "hostname": "…", "username": "…", "home": "C:\\Users\\…\\.dsh" },
  "includes": { "credentials": true, "runtimes": false, "env": true },
  "counts": { "files": 6251, "bytes": 305807394, "sessions": 39, "workspaces": 4 },
  "sessionFormats": ["v4"],
  "workspaces": [{ "title": "goldbet", "path": "C:\\dev\\goldbet" }]
}
```

`manifest.json` makes the archive self-describing: the import can refuse a foreign or
truncated file before anything is staged.

## Import plan and warnings

The plan is computed on the host and shown before the restore. It reports:

- **Project folders that do not exist on this computer.** History stays readable and
  keeps its project, but continuing a session needs its recorded working directory.
  The plugin never rewrites recorded paths — that would silently corrupt the history.
- **Credentials present** in the archive.
- **`.env` present** — proxy settings are machine-specific, so importing `.env` is a
  separate opt-in checkbox, off by default.
- **Version mismatch** when both sides report a DSH runtime version.
- **Newer session-log format** than this plugin knows about (`v0`–`v4`) — blocking.
- **Platform mismatch** (archive made on another OS).
- **Insufficient disk space** (needs roughly twice the uncompressed size: staged copy
  plus the kept backup) — blocking.
- **Runtimes excluded** — DSH downloads them on first launch, which needs network.

Blocking warnings disable **Restore**; the staged copy can be discarded.

## After the restore

- The previous home is kept at `<home>.before-<timestamp>`.
- The restore log is at `<home-parent>/.dsh-portable/logs/restore-<id>.log`.
- The helper can be re-run manually; it is idempotent-safe because it refuses to swap
  when the staged home is missing and rolls the backup back.

### Roll back

1. Quit DSH completely, including the tray icon.
2. Rename the restored `%USERPROFILE%\.dsh` to `.dsh.restored`.
3. Rename `%USERPROFILE%\.dsh.before-<timestamp>` to `.dsh`.
4. Start DSH.

## Notes and limitations

- **Import replaces the entire home**, including the profile and its `node_modules`.
  Plugins installed on the destination but absent from the archive disappear; plugins
  present on the source travel with it (install this plugin on the source before
  exporting if you want it to survive the restore).
- **Same absolute paths give a perfect match.** Workspace records and session headers
  store absolute paths. A different user name or drive layout keeps the history visible
  under its old project but cannot be re-pointed automatically.
- The restore helper is a generated script, not a background service. If DSH is not
  closed within an hour, it exits without changing anything.
- Session logs are append-only; exporting while DSH runs can capture a session at the
  moment of the copy. The format tolerates a torn tail and repairs it on the next open.
- The archive contains tokens and possibly production data. Move it over an encrypted
  channel only.
- `Windows` and POSIX (macOS/Linux CLI installs) are supported; the desktop app is
  Windows-only today.

## Development

```powershell
node --test
```

The suite covers the tar writer/reader (unicode names, long paths, traversal and
checksum rejection, truncation), the manifest and plan, an end-to-end
export → import → apply cycle over a temporary home, the client bundle registration in
a VM, and a real PowerShell restore (swap and rollback) on Windows.

```
lib/archive.js   dependency-free tar + gzip, safe extraction
lib/home.js      scanning, manifest, plan, backup naming, restore scripts
lib/index.js     host plugin: authenticated /api/portable/* routes
lib/client.js    browser plugin: Settings → Portable
cordis.patch.yml bundle layer that mounts the host row
```

## License

MIT
