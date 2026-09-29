// Уборка места на диске. Что считается лишним:
//   • файлы-сироты в data/uploads — на них не ссылается ни одна запись в базе
//     (сменили аватар, удалили заявку или фото, бросили форму). Не трогаем моложе суток:
//     человек мог загрузить фото и ещё не нажать «Сохранить»;
//   • фото давно починенных заявок и их переписки — старше PHOTO_KEEP_DAYS (по умолчанию 365,
//     0 — хранить вечно). Текст переписки остаётся, вместо фото — пометка;
//   • снимки data/ «перед восстановлением» (backups/data.before-restore-*) старше 30 дней.
// Удалённое ещё какое-то время лежит в резервных копиях (их BACKUP_KEEP штук).
// Запуск: каждую ночь в CLEANUP_AT (02:30, off — выключить) и кнопкой в разделе «Резервные копии».
const fs = require("node:fs")
const path = require("node:path")
const db = require("./db")

const ROOT = path.join(__dirname, "..")
const UPLOADS = process.env.UPLOADS_DIR || path.join(ROOT, "data", "uploads")
const BACKUP_ROOT = () => process.env.BACKUP_DIR || path.join(ROOT, "backups")
const DAY = 864e5
const SNAPSHOT_DAYS = 30

function keepDays() {
	const v = Number(process.env.PHOTO_KEEP_DAYS ?? 365)
	return Number.isFinite(v) && v >= 0 ? v : 365
}
const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ")

function dirSize(dir) {
	let n = 0
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name)
		n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size
	}
	return n
}

// Все имена файлов из /uploads/…, упомянутые где угодно в базе. Ищем по всем таблицам целиком,
// а не по списку колонок: новая колонка с фото не должна превратить свои файлы в «сирот».
async function referenced() {
	const set = new Set()
	const tables = await db
		.prepare("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
		.all()
	for (const { t } of tables) {
		const rows = await db.prepare(`SELECT x::text AS s FROM "${t.replace(/"/g, "")}" x WHERE x::text LIKE '%/uploads/%'`).all()
		for (const r of rows) for (const m of r.s.matchAll(/\/uploads\/([\w.-]+)/g)) set.add(m[1])
	}
	return set
}

function uploads() {
	if (!fs.existsSync(UPLOADS)) return []
	return fs
		.readdirSync(UPLOADS, { withFileTypes: true })
		.filter((e) => e.isFile())
		.map((e) => {
			const st = fs.statSync(path.join(UPLOADS, e.name))
			return { name: e.name, size: st.size, mtime: st.mtimeMs }
		})
}

// Починенные заявки с фото, где давно ничего не происходило
async function oldIssues() {
	const days = keepDays()
	if (!days) return []
	const cutoff = utc(Date.now() - days * DAY)
	const rows = await db
		.prepare(
			`SELECT ri.id FROM room_issues ri
			 WHERE ri.status = 'Починено' AND COALESCE(ri.closed_at, ri.created_at) < ?
			   AND NOT EXISTS (SELECT 1 FROM issue_comments ic WHERE ic.issue_id = ri.id AND ic.created_at >= ?)
			   AND (ri.photo IS NOT NULL OR EXISTS (SELECT 1 FROM issue_comments ic WHERE ic.issue_id = ri.id AND ic.photo IS NOT NULL))`,
		)
		.all(cutoff, cutoff)
	return rows.map((r) => r.id)
}
const fileOf = (url) => /^\/uploads\/([\w.-]+)$/.exec(url || "")?.[1]

async function oldPhotoFiles(ids) {
	if (!ids.length) return []
	const rows = await db
		.prepare(
			`SELECT photo FROM room_issues WHERE id = ANY(?) AND photo IS NOT NULL
			 UNION ALL SELECT photo FROM issue_comments WHERE issue_id = ANY(?) AND photo IS NOT NULL`,
		)
		.all(ids, ids)
	return [...new Set(rows.map((r) => fileOf(r.photo)).filter(Boolean))]
}

function snapshots() {
	const root = BACKUP_ROOT()
	if (!fs.existsSync(root)) return []
	return fs
		.readdirSync(root, { withFileTypes: true })
		.filter((e) => e.isDirectory() && /^data\.before-restore-\d+$/.test(e.name))
		.map((e) => {
			const p = path.join(root, e.name)
			return { name: e.name, path: p, size: dirSize(p), mtime: fs.statSync(p).mtimeMs }
		})
}

let lastCleanup = null

// Что занято и что можно освободить — ничего не меняет
async function plan() {
	const files = uploads()
	const refs = await referenced()
	const now = Date.now()
	const orphans = files.filter((f) => !refs.has(f.name) && now - f.mtime > DAY)
	const ids = await oldIssues()
	const oldNames = new Set(await oldPhotoFiles(ids))
	const oldFiles = files.filter((f) => oldNames.has(f.name))
	const snaps = snapshots().filter((s) => now - s.mtime > SNAPSHOT_DAYS * DAY)
	const sum = (a) => a.reduce((s, x) => s + x.size, 0)
	const root = BACKUP_ROOT()
	return {
		keep_days: keepDays(),
		uploads: { count: files.length, size: sum(files) },
		backups_size: fs.existsSync(root) ? dirSize(root) : 0,
		db_size: Number((await db.prepare("SELECT pg_database_size(current_database()) AS s").get()).s),
		orphans: { count: orphans.length, size: sum(orphans) },
		old_photos: { issues: ids.length, count: oldFiles.length, size: sum(oldFiles) },
		snapshots: { count: snaps.length, size: sum(snaps) },
		last: lastCleanup,
	}
}

function rm(file) {
	try {
		fs.unlinkSync(path.join(UPLOADS, file))
		return true
	} catch {
		return false
	}
}

async function cleanup() {
	const ids = await oldIssues()
	const oldSet = new Set(await oldPhotoFiles(ids))
	if (ids.length) {
		await db.tx(async (t) => {
			await t.prepare("UPDATE room_issues SET photo = NULL WHERE id = ANY(?)").run(ids)
			await t
				.prepare(
					`UPDATE issue_comments SET photo = NULL,
					   text = CASE WHEN COALESCE(text, '') = '' THEN ? ELSE text END
					 WHERE issue_id = ANY(?) AND photo IS NOT NULL`,
				)
				.run(`📷 Фото удалено: заявка закрыта больше ${keepDays()} дней назад`, ids)
		})
	}
	// Ссылки на старые фото сняты — теперь это тоже сироты. Удаляем только то, на что после
	// этого действительно никто не ссылается (одно фото могло стоять в двух местах).
	const refs = await referenced()
	const now = Date.now()
	let freed = 0
	let files = 0
	for (const f of uploads()) {
		if (refs.has(f.name)) continue
		if (!oldSet.has(f.name) && now - f.mtime <= DAY) continue
		if (rm(f.name)) {
			freed += f.size
			files++
		}
	}
	let snaps = 0
	for (const s of snapshots()) {
		if (now - s.mtime <= SNAPSHOT_DAYS * DAY) continue
		fs.rmSync(s.path, { recursive: true, force: true })
		freed += s.size
		snaps++
	}
	lastCleanup = { at: new Date().toISOString(), files, issues: ids.length, snapshots: snaps, freed }
	if (files || snaps) console.log(`Уборка: файлов ${files}, снимков ${snaps}, освобождено ${(freed / 1048576).toFixed(1)} МБ`)
	return lastCleanup
}

let running = null
// Два запуска сразу (ночной и кнопкой) не пересекаются — второй получает результат первого
const cleanupOnce = () => (running ??= cleanup().finally(() => (running = null)))

function schedule() {
	const at = process.env.CLEANUP_AT || "02:30"
	if (at === "off") return
	const m = /^(\d{1,2}):(\d{2})$/.exec(at)
	if (!m) return console.error(`CLEANUP_AT="${at}" — ожидается ЧЧ:ММ или off. Автоуборка выключена.`)
	const next = new Date()
	next.setHours(+m[1], +m[2], 0, 0)
	if (next <= new Date()) next.setDate(next.getDate() + 1)
	setTimeout(() => {
		cleanupOnce().catch((e) => console.error("Уборка:", e.message))
		schedule()
	}, next - Date.now()).unref()
}

module.exports = { plan, cleanup: cleanupOnce, schedule }
