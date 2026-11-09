window.__ModuleLoader__.load({
	id: "dsh-portable",
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

		const React = require("react")
		const h = React.createElement
		const NS = "portable"

		/* ------------------------------------------------------------------ */
		/* styles                                                             */
		/* ------------------------------------------------------------------ */

		const CSS = `
.dshp-root{display:flex;flex-direction:column;gap:18px;padding:4px 0 24px;max-width:860px}
.dshp-title{font-size:16px;line-height:24px;font-weight:600}
.dshp-subtitle{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin-top:4px}
.dshp-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.dshp-card-title{font-size:14px;line-height:20px;font-weight:600}
.dshp-card-text{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dshp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dshp-row-between{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dshp-check{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:20px;cursor:pointer}
.dshp-check input{margin-top:3px}
.dshp-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;border-radius:8px;padding:7px 14px;font-size:13px;line-height:18px;cursor:pointer}
.dshp-btn:disabled{opacity:.5;cursor:not-allowed}
.dshp-btn-primary{background:var(--dsw-alias-brand-primary,#3b6cf6);border-color:transparent;color:#fff}
.dshp-btn-danger{border-color:#d9534f;color:#d9534f}
.dshp-file{position:relative;overflow:hidden;display:inline-flex}
.dshp-file input{position:absolute;inset:0;opacity:0;cursor:pointer}
.dshp-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);border-left:3px solid var(--dsw-alias-border-l2);padding-left:10px}
.dshp-warn{font-size:12px;line-height:18px;padding:8px 10px;border-radius:8px;background:rgba(214,158,46,.12);color:#9a6b00}
.dshp-danger{font-size:12px;line-height:18px;padding:8px 10px;border-radius:8px;background:rgba(217,83,79,.12);color:#b03a37}
.dshp-info{font-size:12px;line-height:18px;padding:8px 10px;border-radius:8px;background:rgba(59,108,246,.10);color:var(--dsw-alias-label-secondary)}
.dshp-list{margin:0;padding-left:18px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dshp-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all}
.dshp-kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;font-size:12px;line-height:18px}
.dshp-kv dt{color:var(--dsw-alias-label-secondary)}
.dshp-kv dd{margin:0;word-break:break-all}
.dshp-badge{display:inline-block;font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-border-l2)}
.dshp-sep{height:1px;background:var(--dsw-alias-border-l2);margin:2px 0}
`

		function ensureStyles() {
			if (typeof document === "undefined") return
			if (document.querySelector("style[data-dsh-portable]") !== null) return
			const tag = document.createElement("style")
			tag.dataset.dshPortable = "1"
			tag.textContent = CSS
			document.head.appendChild(tag)
		}

		/* ------------------------------------------------------------------ */
		/* locales                                                            */
		/* ------------------------------------------------------------------ */

		const en = {
			nav: "Portable",
			title: "Move DSH to another computer",
			subtitle: "One archive with settings, session history, attachments and scheduled tasks; restore it on the other machine.",
			"status.loading": "Reading the harness home…",
			"status.home": "Harness home",
			"status.version": "DSH version",
			"status.sessions": "Sessions",
			"status.workspaces": "Projects",
			"status.unknown": "unknown",
			"export.title": "Export",
			"export.text": "Downloads one .tar.gz with the whole harness home. The archive is written live and always contains the current state.",
			"export.credentials": "Include access credentials (.credentials.yaml)",
			"export.credentialsHint": "Without them the other computer asks you to sign in again.",
			"export.runtimes": "Include Python/Node runtime (~250 MB)",
			"export.runtimesHint": "Only needed when the other computer has no network on first launch.",
			"export.button": "Download archive",
			"export.busy": "Preparing archive…",
			"export.started": "The archive is being prepared; the browser download starts as soon as it begins streaming.",
			"export.secret": "The archive may contain tokens, credentials and production data. Move it over an encrypted channel only.",
			"import.title": "Import",
			"import.text": "Pick an archive exported by this plugin. It is unpacked into a staging directory and checked before anything is replaced.",
			"import.choose": "Choose archive…",
			"import.busy": "Uploading and checking the archive…",
			"import.invalid": "This file is not a dsh-portable archive.",
			"plan.title": "Restore plan",
			"plan.source": "Source",
			"plan.created": "Created",
			"plan.version": "Source DSH",
			"plan.sessions": "Sessions",
			"plan.files": "Files",
			"plan.size": "Size",
			"plan.replace": "The current harness home will be replaced. The old one is kept next to it as a backup, so the operation can be undone by renaming directories.",
			"plan.options": "On this computer",
			"plan.keepCredentials": "Import access credentials from the archive",
			"plan.keepCredentialsHint": "Uncheck to keep this computer's sign-in and sign in again if needed.",
			"plan.keepEnv": "Import .env (proxy settings)",
			"plan.keepEnvHint": "Leave unchecked unless this computer uses the same proxy; otherwise DSH may fail to reach the API after restore.",
			"plan.confirm": "I understand that the current settings and history will be replaced",
			"plan.apply": "Restore and close DSH",
			"plan.discard": "Discard",
			"plan.blocked": "Fix the blocking warnings and export again.",
			"plan.applying": "Preparing the restore helper…",
			"restore.title": "Restore is armed",
			"restore.text": "Close DSH completely, including the tray icon. The helper waits for DSH to exit, swaps the harness home and starts DSH again.",
			"restore.backup": "Backup of the current home",
			"restore.script": "Restore script (can be run manually later)",
			"restore.log": "Log",
			"restore.relaunch": "DSH will be started again automatically.",
			"restore.norelaunch": "Start DSH manually after the restore finishes.",
			"error.generic": "Something went wrong.",
			"warn.credentials-included": "The archive contains access credentials.",
			"warn.env-included": "The archive contains .env; proxy settings are machine-specific.",
			"warn.runtimes-excluded": "Python/Node runtime is not included; DSH downloads it on first launch (network needed).",
			"warn.workspaces-missing": "Some project folders do not exist on this computer. History stays readable, but continuing those sessions needs the folders.",
			"warn.version-mismatch": "The archive was made by another DSH version.",
			"warn.platform-mismatch": "The archive was made on another operating system.",
			"warn.same-home": "The archive was exported from this same harness home.",
			"warn.disk-space": "Not enough free disk space for the restore.",
			"warn.format-unsupported": "Unsupported archive format.",
			"warn.session-format-newer": "The archive contains a newer session-log format than this DSH can read.",
			"common.error": "Error",
			"common.close": "Close",
			"common.refresh": "Refresh",
			"common.bytes": "B",
			"common.kb": "KB",
			"common.mb": "MB",
			"common.gb": "GB",
		}

		const ru = {
			nav: "Перенос",
			title: "Перенос DSH на другой компьютер",
			subtitle: "Один архив с настройками, историей сессий, вложениями и плановыми задачами; на другой машине он разворачивается целиком.",
			"status.loading": "Читаю папку DSH…",
			"status.home": "Папка DSH",
			"status.version": "Версия DSH",
			"status.sessions": "Сессии",
			"status.workspaces": "Проекты",
			"status.unknown": "неизвестно",
			"export.title": "Экспорт",
			"export.text": "Скачивает один .tar.gz со всей папкой DSH. Архив собирается на лету и всегда содержит текущее состояние.",
			"export.credentials": "Включить учётные данные (.credentials.yaml)",
			"export.credentialsHint": "Без них на другом компьютере придётся войти заново.",
			"export.runtimes": "Включить рантаймы Python/Node (~250 МБ)",
			"export.runtimesHint": "Нужно только если на новой машине не будет интернета при первом запуске.",
			"export.button": "Скачать архив",
			"export.busy": "Готовлю архив…",
			"export.started": "Архив собирается; загрузка начнётся, как только пойдёт поток данных.",
			"export.secret": "В архиве могут быть токены, доступы и рабочие данные. Передавайте его только по защищённому каналу.",
			"import.title": "Импорт",
			"import.text": "Выберите архив, сделанный этим плагином. Он распакуется во временную папку и будет проверен до того, как что-то заменится.",
			"import.choose": "Выбрать архив…",
			"import.busy": "Загружаю и проверяю архив…",
			"import.invalid": "Это не архив dsh-portable.",
			"plan.title": "План восстановления",
			"plan.source": "Источник",
			"plan.created": "Создан",
			"plan.version": "DSH источника",
			"plan.sessions": "Сессии",
			"plan.files": "Файлы",
			"plan.size": "Размер",
			"plan.replace": "Текущая папка DSH будет заменена. Старая сохранится рядом как бэкап, так что операцию можно откатить переименованием папок.",
			"plan.options": "На этом компьютере",
			"plan.keepCredentials": "Импортировать учётные данные из архива",
			"plan.keepCredentialsHint": "Снимите галочку, чтобы сохранить текущий вход и при необходимости войти заново.",
			"plan.keepEnv": "Импортировать .env (настройки прокси)",
			"plan.keepEnvHint": "Оставьте выключенным, если на этой машине другой прокси или его нет; иначе после восстановления DSH не достучится до API.",
			"plan.confirm": "Я понимаю, что текущие настройки и история будут заменены",
			"plan.apply": "Восстановить и закрыть DSH",
			"plan.discard": "Отменить",
			"plan.blocked": "Устраните блокирующие предупреждения и сделайте архив заново.",
			"plan.applying": "Готовлю помощник восстановления…",
			"restore.title": "Восстановление взведено",
			"restore.text": "Полностью закройте DSH, включая значок в трее. Помощник дождётся выхода, заменит папку DSH и запустит приложение снова.",
			"restore.backup": "Бэкап текущей папки",
			"restore.script": "Скрипт восстановления (можно запустить вручную позже)",
			"restore.log": "Лог",
			"restore.relaunch": "DSH будет запущен автоматически.",
			"restore.norelaunch": "После восстановления запустите DSH вручную.",
			"error.generic": "Что-то пошло не так.",
			"warn.credentials-included": "В архиве есть учётные данные.",
			"warn.env-included": "В архиве есть .env; настройки прокси привязаны к конкретной машине.",
			"warn.runtimes-excluded": "Рантаймы Python/Node не включены; DSH скачает их при первом запуске (нужен интернет).",
			"warn.workspaces-missing": "Часть папок проектов на этой машине отсутствует. История останется читаемой, но продолжить такие сессии нельзя, пока папок нет.",
			"warn.version-mismatch": "Архив сделан другой версией DSH.",
			"warn.platform-mismatch": "Архив сделан на другой операционной системе.",
			"warn.same-home": "Архив экспортирован из этой же папки DSH.",
			"warn.disk-space": "Не хватает свободного места для восстановления.",
			"warn.format-unsupported": "Неподдерживаемый формат архива.",
			"warn.session-format-newer": "В архиве более новый формат журналов сессий, чем умеет читать эта версия DSH.",
			"common.error": "Ошибка",
			"common.close": "Закрыть",
			"common.refresh": "Обновить",
			"common.bytes": "Б",
			"common.kb": "КБ",
			"common.mb": "МБ",
			"common.gb": "ГБ",
		}

		function formatBytes(value) {
			const number = Number(value)
			if (!Number.isFinite(number) || number <= 0) return "0"
			const units = ["B", "KB", "MB", "GB", "TB"]
			let index = 0
			let size = number
			while (size >= 1024 && index < units.length - 1) {
				size /= 1024
				index += 1
			}
			return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
		}

		function formatDate(value) {
			try {
				return new Date(value).toLocaleString()
			} catch {
				return String(value ?? "")
			}
		}

		/* ------------------------------------------------------------------ */
		/* section                                                            */
		/* ------------------------------------------------------------------ */

		function PortableSection(props) {
			const t = typeof props.t === "function" ? props.t : (key) => key

			const [status, setStatus] = React.useState(null)
			const [statusError, setStatusError] = React.useState(null)
			const [busy, setBusy] = React.useState(null)
			const [notice, setNotice] = React.useState(null)
			const [plan, setPlan] = React.useState(null)
			const [restore, setRestore] = React.useState(null)
			const [confirmed, setConfirmed] = React.useState(false)

			const [includeCredentials, setIncludeCredentials] = React.useState(true)
			const [includeRuntimes, setIncludeRuntimes] = React.useState(false)
			const [keepCredentials, setKeepCredentials] = React.useState(true)
			const [keepEnv, setKeepEnv] = React.useState(false)

			const alive = React.useRef(true)
			React.useEffect(() => () => {
				alive.current = false
			}, [])

			const loadStatus = React.useCallback(async () => {
				try {
					const response = await fetch("/api/portable/status", { headers: { accept: "application/json" } })
					const payload = await response.json()
					if (!alive.current) return
					if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
					setStatus(payload)
					setStatusError(null)
				} catch (error) {
					if (!alive.current) return
					setStatusError(error instanceof Error ? error.message : String(error))
				}
			}, [])

			React.useEffect(() => {
				loadStatus()
			}, [loadStatus])

			const startExport = async () => {
				setBusy("export")
				setNotice(null)
				const query = new URLSearchParams({
					credentials: includeCredentials ? "1" : "0",
					runtimes: includeRuntimes ? "1" : "0",
				})
				const url = `/api/portable/export?${query.toString()}`
				try {
					const check = await fetch(url, { method: "HEAD" })
					if (!check.ok) {
						const detail = await check.text().catch(() => "")
						throw new Error(`HTTP ${check.status}${detail === "" ? "" : `: ${detail}`}`)
					}
					const anchor = document.createElement("a")
					anchor.href = url
					anchor.download = `dsh-portable-${new Date().toISOString().slice(0, 10)}.tar.gz`
					document.body.appendChild(anchor)
					anchor.click()
					anchor.remove()
					setNotice({ kind: "info", text: t("export.started") })
				} catch (error) {
					setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) })
				} finally {
					setBusy(null)
				}
			}

			const chooseArchive = async (event) => {
				const file = event.target.files?.[0]
				event.target.value = ""
				if (!file) return
				setBusy("import")
				setNotice(null)
				setPlan(null)
				setRestore(null)
				setConfirmed(false)
				try {
					const response = await fetch("/api/portable/import", {
						method: "POST",
						headers: { "content-type": "application/gzip" },
						body: file,
					})
					const payload = await response.json()
					if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
					if (!alive.current) return
					setPlan(payload)
					setKeepCredentials(payload?.manifest?.includes?.credentials === true)
					setKeepEnv(payload?.manifest?.includes?.env === true)
				} catch (error) {
					if (!alive.current) return
					setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) })
				} finally {
					if (alive.current) setBusy(null)
				}
			}

			const applyPlan = async () => {
				if (!plan || confirmed !== true) return
				setBusy("apply")
				setNotice(null)
				try {
					const response = await fetch("/api/portable/apply", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							staging: plan.staging,
							importCredentials: keepCredentials,
							importEnv: keepEnv,
							relaunch: true,
						}),
					})
					const payload = await response.json()
					if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
					if (!alive.current) return
					setRestore(payload)
				} catch (error) {
					if (!alive.current) return
					setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) })
				} finally {
					if (alive.current) setBusy(null)
				}
			}

			const discardPlan = async () => {
				const staging = plan?.staging
				setPlan(null)
				setRestore(null)
				setConfirmed(false)
				if (!staging) return
				try {
					await fetch("/api/portable/discard", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ staging }),
					})
				} catch {
					// Discarding is best-effort; stale staging is pruned later.
				}
			}

			const warningText = (warning) => {
				const base = t(`warn.${warning.code}`)
				const params = warning.params ?? {}
				if (warning.code === "workspaces-missing") {
					const sample = Array.isArray(params.sample) ? params.sample.join(", ") : ""
					return `${base} (${params.count}${sample === "" ? "" : `: ${sample}`})`
				}
				if (warning.code === "version-mismatch") return `${base} ${params.from} → ${params.to}`
				if (warning.code === "platform-mismatch") return `${base} ${params.from} → ${params.to}`
				if (warning.code === "disk-space") return `${base} (${formatBytes(params.required)} / ${formatBytes(params.free)})`
				if (warning.code === "session-format-newer") {
					const formats = Array.isArray(params.formats) ? params.formats.join(", ") : ""
					return `${base} (${formats})`
				}
				return base
			}

			const warnings = plan?.plan?.warnings ?? []
			const orderedWarnings = [...warnings].sort((left, right) => {
				const rank = { danger: 0, warn: 1, info: 2 }
				return (rank[left.level] ?? 3) - (rank[right.level] ?? 3)
			})

			return h("div", { className: "dshp-root" },
				h("div", null,
					h("div", { className: "dshp-title" }, t("title")),
					h("div", { className: "dshp-subtitle" }, t("subtitle")),
				),

				status === null && statusError === null
					? h("div", { className: "dshp-card-text" }, t("status.loading"))
					: null,
				statusError !== null
					? h("div", { className: "dshp-danger" }, `${t("common.error")}: ${statusError}`)
					: null,
				status !== null
					? h("dl", { className: "dshp-kv" },
						h("dt", null, t("status.home")),
						h("dd", { className: "dshp-mono" }, status.home),
						h("dt", null, t("status.version")),
						h("dd", null, status.version ?? t("status.unknown")),
						h("dt", null, t("status.sessions")),
						h("dd", null, String(status.sessions ?? 0)),
						h("dt", null, t("status.workspaces")),
						h("dd", null, String(status.workspaces?.length ?? 0)),
					)
					: null,

				notice !== null
					? h("div", { className: notice.kind === "error" ? "dshp-danger" : "dshp-info" }, notice.text)
					: null,

				h("div", { className: "dshp-card" },
					h("div", { className: "dshp-card-title" }, t("export.title")),
					h("div", { className: "dshp-card-text" }, t("export.text")),
					h("label", { className: "dshp-check" },
						h("input", {
							type: "checkbox",
							checked: includeCredentials,
							onChange: (event) => setIncludeCredentials(event.target.checked),
						}),
						h("span", null,
							h("div", null, t("export.credentials")),
							h("div", { className: "dshp-card-text" }, t("export.credentialsHint")),
						),
					),
					h("label", { className: "dshp-check" },
						h("input", {
							type: "checkbox",
							checked: includeRuntimes,
							onChange: (event) => setIncludeRuntimes(event.target.checked),
						}),
						h("span", null,
							h("div", null, t("export.runtimes")),
							h("div", { className: "dshp-card-text" }, t("export.runtimesHint")),
						),
					),
					h("div", { className: "dshp-row" },
						h("button", {
							type: "button",
							className: "dshp-btn dshp-btn-primary",
							disabled: busy !== null,
							onClick: startExport,
						}, busy === "export" ? t("export.busy") : t("export.button")),
					),
					h("div", { className: "dshp-note" }, t("export.secret")),
				),

				h("div", { className: "dshp-card" },
					h("div", { className: "dshp-card-title" }, t("import.title")),
					h("div", { className: "dshp-card-text" }, t("import.text")),
					h("div", { className: "dshp-row" },
						h("label", { className: "dshp-btn dshp-file" },
							t("import.choose"),
							h("input", {
								type: "file",
								accept: ".gz,.tgz,.tar.gz,application/gzip",
								disabled: busy !== null,
								onChange: chooseArchive,
							}),
						),
						busy === "import" ? h("span", { className: "dshp-card-text" }, t("import.busy")) : null,
					),
				),

				plan !== null
					? h("div", { className: "dshp-card" },
						h("div", { className: "dshp-card-title" }, t("plan.title")),
						h("dl", { className: "dshp-kv" },
							h("dt", null, t("plan.source")),
							h("dd", null, `${plan.manifest?.source?.hostname ?? "?"} / ${plan.manifest?.source?.username ?? "?"}`),
							h("dt", null, t("plan.created")),
							h("dd", null, formatDate(plan.manifest?.createdAt)),
							h("dt", null, t("plan.version")),
							h("dd", null, plan.manifest?.app?.version ?? t("status.unknown")),
							h("dt", null, t("plan.sessions")),
							h("dd", null, String(plan.manifest?.counts?.sessions ?? 0)),
							h("dt", null, t("plan.files")),
							h("dd", null, String(plan.manifest?.counts?.files ?? 0)),
							h("dt", null, t("plan.size")),
							h("dd", null, formatBytes(plan.manifest?.counts?.bytes ?? plan.sizeBytes)),
						),
						orderedWarnings.length > 0
							? h("div", { className: "dshp-row", style: { flexDirection: "column", alignItems: "stretch" } },
								...orderedWarnings.map((warning, index) => h("div", {
									key: `${warning.code}-${index}`,
									className: warning.level === "danger" ? "dshp-danger" : warning.level === "warn" ? "dshp-warn" : "dshp-info",
								}, warningText(warning))),
							)
							: null,
						h("div", { className: "dshp-sep" }),
						h("div", { className: "dshp-card-text" }, t("plan.options")),
						h("label", { className: "dshp-check" },
							h("input", {
								type: "checkbox",
								checked: keepCredentials,
								onChange: (event) => setKeepCredentials(event.target.checked),
							}),
							h("span", null,
								h("div", null, t("plan.keepCredentials")),
								h("div", { className: "dshp-card-text" }, t("plan.keepCredentialsHint")),
							),
						),
						h("label", { className: "dshp-check" },
							h("input", {
								type: "checkbox",
								checked: keepEnv,
								onChange: (event) => setKeepEnv(event.target.checked),
							}),
							h("span", null,
								h("div", null, t("plan.keepEnv")),
								h("div", { className: "dshp-card-text" }, t("plan.keepEnvHint")),
							),
						),
						h("div", { className: "dshp-note" }, t("plan.replace")),
						plan.plan?.canApply !== true
							? h("div", { className: "dshp-danger" }, t("plan.blocked"))
							: h("label", { className: "dshp-check" },
								h("input", {
									type: "checkbox",
									checked: confirmed,
									onChange: (event) => setConfirmed(event.target.checked),
								}),
								h("span", null, t("plan.confirm")),
							),
						h("div", { className: "dshp-row" },
							h("button", {
								type: "button",
								className: "dshp-btn dshp-btn-primary",
								disabled: busy !== null || confirmed !== true || plan.plan?.canApply !== true,
								onClick: applyPlan,
							}, busy === "apply" ? t("plan.applying") : t("plan.apply")),
							h("button", {
								type: "button",
								className: "dshp-btn",
								disabled: busy !== null,
								onClick: discardPlan,
							}, t("plan.discard")),
						),
					)
					: null,

				restore !== null
					? h("div", { className: "dshp-card" },
						h("div", { className: "dshp-card-title" }, t("restore.title")),
						h("div", { className: "dshp-card-text" }, t("restore.text")),
						h("dl", { className: "dshp-kv" },
							h("dt", null, t("restore.backup")),
							h("dd", { className: "dshp-mono" }, restore.backup),
							h("dt", null, t("restore.log")),
							h("dd", { className: "dshp-mono" }, restore.log),
							h("dt", null, t("restore.script")),
							h("dd", { className: "dshp-mono" }, restore.script),
						),
						h("div", { className: "dshp-info" }, restore.relaunch ? t("restore.relaunch") : t("restore.norelaunch")),
					)
					: null,
			)
		}

		/* ------------------------------------------------------------------ */
		/* plugin                                                             */
		/* ------------------------------------------------------------------ */

		const inject = ["slots", "locale"]

		function apply(ctx) {
			ensureStyles()
			const t = ctx.locale.bind(NS)
			ctx.effect(() => ctx.locale.register(NS, { en, ru }), "dsh-portable: dictionaries")

			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "portable",
				order: 85,
				label: () => t("nav"),
				locale: NS,
			}, PortableSection))
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	},
})
