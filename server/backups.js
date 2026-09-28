// Резервные копии из интерфейса администратора + ежедневный автобэкап.
//
// Сама работа — в scripts/backup.js и scripts/restore.js (их же запускают руками
// и из cron). Здесь только очередь, расписание и HTTP-обёртка.
//
// Защита от случайностей:
//   • удалить копию можно, только введя её имя; закреплённую и единственную — нельзя;
//   • перед восстановлением автоматически снимается копия текущего состояния,
//     и она закрепляется — так восстановление всегда можно откатить;
//   • одновременно выполняется только одна операция.
const fs = require("node:fs")
const path = require("node:path")
const { spawn } = require("node:child_process")
const express = require("express")

const ROOT = path.join(__dirname, "..")
const BACKUP_ROOT = () => process.env.BACKUP_DIR || path.join(ROOT, "backups")
// Имя копии — время снятия: 2026-09-28_0300 (старые) или 2026-09-28_030015
const NAME_RE = /^\d{4}-\d{2}-\d{2}_\d{4}(\d{2})?$/

let busy = null // { kind: "backup" | "restore", since }
let lastRun = null // { at, ok, name, error, note }
let nextRun = null

function run(script, args, env = {}) {
	return new Promise((resolve) => {
		const p = spawn(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
			env: { ...process.env, ...env },
		})
		let out = ""
		p.stdout.on("data", (d) => (out += d))
		p.stderr.on("data", (d) => (out += d))
		p.on("error", (e) => resolve({ code: 1, out: e.message }))
		p.on("exit", (code) => {
			process.stdout.write(out)
			resolve({ code, out })
		})
	})
}

function dirOf(name) {
	if (!NAME_RE.test(name || "")) return null
	const dir = path.join(BACKUP_ROOT(), name)
	return fs.existsSync(dir) ? dir : null
}

function list() {
	const root = BACKUP_ROOT()
	if (!fs.existsSync(root)) return []
	return fs
		.readdirSync(root, { withFileTypes: true })
		.filter((e) => e.isDirectory() && NAME_RE.test(e.name))
		.map((e) => {
			const dir = path.join(root, e.name)
			let m = null
			try {
				m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"))
			} catch {}
			const keep = path.join(dir, ".keep")
			return {
				name: e.name,
				created_at: m?.created_at || fs.statSync(dir).mtime.toISOString(),
				db_size: m?.database_dump?.size ?? null,
				files_size: m?.files?.size ?? null,
				tables: m?.database_dump?.tables_with_data ?? null,
				note: m?.note || null,
				complete: !!m,
				pinned: fs.existsSync(keep),
				pin_note: fs.existsSync(keep) ? fs.readFileSync(keep, "utf8").trim() || null : null,
			}
		})
		.sort((a, b) => b.name.localeCompare(a.name))
}

async function exclusive(kind, fn) {
	if (busy) {
		const err = new Error(busy.kind === "restore" ? "Идёт восстановление — дождитесь окончания" : "Копия уже снимается — дождитесь окончания")
		err.status = 409
		throw err
	}
	busy = { kind, since: new Date().toISOString() }
	try {
		return await fn()
	} finally {
		busy = null
	}
}

async function snapshot(note) {
	const r = await run("backup.js", [], { BACKUP_NOTE: note })
	const name = (/каталог:\s*(.+)$/m.exec(r.out)?.[1] || "").trim().split(/[\\/]/).pop()
	lastRun = { at: new Date().toISOString(), ok: r.code === 0, name: r.code === 0 ? name : null, note }
	if (r.code !== 0) {
		lastRun.error = (/не выполнено:\s*(.+)$/m.exec(r.out)?.[1] || r.out.trim().split("\n").pop() || "ошибка").slice(0, 500)
		const err = new Error(`Копия не снята: ${lastRun.error}`)
		err.status = 500
		throw err
	}
	return name
}

const createBackup = (note) => exclusive("backup", () => snapshot(note))

// ── Расписание ────────────────────────────────────────────────────────────────
// Раз в сутки в BACKUP_AT (по умолчанию 03:00, по часам сервера).
// BACKUP_AT=off — выключить (например, если бэкапит внешний cron/systemd-таймер).
function schedule() {
	const at = process.env.BACKUP_AT || "03:00"
	if (at === "off") return
	const m = /^(\d{1,2}):(\d{2})$/.exec(at)
	if (!m) return console.error(`BACKUP_AT="${at}" — ожидается ЧЧ:ММ или off. Автобэкап выключен.`)
	const next = new Date()
	next.setHours(+m[1], +m[2], 0, 0)
	if (next <= new Date()) next.setDate(next.getDate() + 1)
	nextRun = next.toISOString()
	setTimeout(() => {
		createBackup("по расписанию").catch((e) => console.error("Автобэкап:", e.message))
		schedule()
	}, next - Date.now()).unref()
	console.log(`Автобэкап: следующий ${next.toLocaleString("ru-RU")}`)
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
const router = express.Router()
const handle = (fn) => (req, res) =>
	Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: e.message }))

function need(req) {
	const dir = dirOf(req.params.name)
	if (!dir) throw Object.assign(new Error("Копия не найдена"), { status: 404 })
	return dir
}

router.get(
	"/",
	handle(async (_req, res) => {
		res.json({
			items: list(),
			busy,
			lastRun,
			schedule: {
				at: process.env.BACKUP_AT || "03:00",
				next: nextRun,
				keep: Math.max(1, Number(process.env.BACKUP_KEEP) || 14),
				dir: BACKUP_ROOT(),
			},
		})
	}),
)

router.post(
	"/",
	handle(async (req, res) => {
		const note = String(req.body?.note || "").trim().slice(0, 200)
		const name = await createBackup(note || `вручную · ${req.user.username}`)
		res.json({ ok: true, name })
	}),
)

router.get(
	"/:name/download",
	handle(async (req, res) => {
		const dir = need(req)
		res.setHeader("Content-Type", "application/x-tar")
		res.setHeader("Content-Disposition", `attachment; filename="hiagda-backup-${req.params.name}.tar"`)
		const tar = spawn("tar", ["-cf", "-", "-C", path.dirname(dir), path.basename(dir)])
		tar.on("error", () => res.destroy())
		tar.stdout.pipe(res)
	}),
)

// Закрепить: автоочистка такую копию не тронет, удалить её тоже нельзя
router.put(
	"/:name/pin",
	handle(async (req, res) => {
		const keep = path.join(need(req), ".keep")
		if (req.body?.pinned) fs.writeFileSync(keep, String(req.body.note || "").slice(0, 200))
		else fs.rmSync(keep, { force: true })
		res.json({ ok: true })
	}),
)

router.delete(
	"/:name",
	handle(async (req, res) => {
		const dir = need(req)
		if (req.body?.confirm !== req.params.name) return res.status(400).json({ error: "Введите имя копии для подтверждения" })
		if (fs.existsSync(path.join(dir, ".keep"))) return res.status(409).json({ error: "Копия закреплена — сначала открепите её" })
		if (list().filter((b) => b.complete).length <= 1) return res.status(409).json({ error: "Это единственная копия — её удалять нельзя" })
		await exclusive("backup", async () => fs.rmSync(dir, { recursive: true, force: true }))
		res.json({ ok: true })
	}),
)

router.post(
	"/:name/restore",
	handle(async (req, res) => {
		const dir = need(req)
		if (req.body?.confirm !== req.params.name) return res.status(400).json({ error: "Введите имя копии для подтверждения" })
		const safety = await exclusive("restore", async () => {
			// Сначала — копия текущего состояния: если восстановили не то, откатываемся на неё.
			const name = await snapshot(`перед восстановлением из ${req.params.name} · ${req.user.username}`)
			fs.writeFileSync(path.join(BACKUP_ROOT(), name, ".keep"), `автокопия перед восстановлением из ${req.params.name}`)
			const r = await run("restore.js", [dir, "--yes"])
			if (r.code !== 0) {
				const msg = r.out.trim().split("\n").filter(Boolean).pop() || "ошибка"
				throw Object.assign(new Error(`Восстановление не выполнено: ${msg}`), { status: 500 })
			}
			return name
		})
		res.json({ ok: true, safety })
	}),
)

module.exports = { router, schedule, createBackup }
