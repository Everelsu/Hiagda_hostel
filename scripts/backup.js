#!/usr/bin/env node
// Резервное копирование «Хиагды»: дамп базы PostgreSQL + загруженные файлы.
//
//   npm run backup                  — снять копию в ./backups
//   BACKUP_DIR=/srv/backup npm run backup
//   BACKUP_KEEP=30 npm run backup   — сколько копий хранить (по умолчанию 14)
//
// Каждая копия — отдельный каталог со временем в имени:
//   backups/2026-09-09_0300/
//     database.dump   дамп в формате custom (сжатый, восстанавливается pg_restore)
//     files.tar.gz    содержимое data/ — фотографии номеров, вложения к заявкам
//     manifest.json   что, когда и чем снято, размеры и контрольные суммы
//
// Восстановление: node scripts/restore.js backups/2026-09-09_0300 --yes
require("../server/env").loadEnv()

const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { spawnSync } = require("node:child_process")

const ROOT = path.join(__dirname, "..")
const DATA_DIR = path.join(ROOT, "data")
const BACKUP_ROOT = process.env.BACKUP_DIR || path.join(ROOT, "backups")
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 14)

// ── Параметры подключения ─────────────────────────────────────────────────────
// Пароль передаём только через окружение дочернего процесса: в аргументах команды
// он был бы виден любому пользователю сервера в выводе ps.
function connection() {
	if (process.env.DATABASE_URL) {
		return { args: ["--dbname", process.env.DATABASE_URL], env: {}, label: safeUrl(process.env.DATABASE_URL) }
	}
	const env = {
		PGHOST: process.env.PGHOST || "127.0.0.1",
		PGPORT: process.env.PGPORT || "5432",
		PGDATABASE: process.env.PGDATABASE || "nochotel",
		PGUSER: process.env.PGUSER || "nochotel",
	}
	if (process.env.PGPASSWORD) env.PGPASSWORD = process.env.PGPASSWORD
	// Базу назначения передаём явным --dbname: pg_restore, в отличие от pg_dump,
	// переменную PGDATABASE не читает и без этого флага просто печатает SQL в stdout,
	// ничего не восстанавливая.
	return {
		args: ["--dbname", env.PGDATABASE],
		env,
		label: `${env.PGUSER}@${env.PGHOST}:${env.PGPORT}/${env.PGDATABASE}`,
	}
}

// Пароль из строки подключения не должен попасть ни в лог, ни в манифест.
function safeUrl(url) {
	try {
		const u = new URL(url)
		if (u.password) u.password = "***"
		return u.toString()
	} catch {
		return "postgresql://***"
	}
}

function tool(name) {
	const dir = process.env.PG_BIN
	return dir ? path.join(dir, name) : name
}

function run(cmd, args, extraEnv = {}) {
	const r = spawnSync(cmd, args, {
		env: { ...process.env, ...extraEnv },
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	})
	if (r.error && r.error.code === "ENOENT") {
		throw new Error(
			`не найдена программа «${cmd}». Установите клиент PostgreSQL (пакет postgresql-client) ` +
				"или укажите каталог с ним в переменной PG_BIN.",
		)
	}
	if (r.status !== 0) throw new Error(`${cmd} завершился с кодом ${r.status}: ${(r.stderr || "").trim()}`)
	return r.stdout
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} МБ`

function stamp(d = new Date()) {
	const p = (n) => String(n).padStart(2, "0")
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// ── Файлы приложения ──────────────────────────────────────────────────────────
// Дамп базы без загруженных картинок бесполезен: в БД лежат только ссылки на них.
function archiveData(target) {
	if (!fs.existsSync(DATA_DIR)) return null
	try {
		run("tar", ["-czf", target, "-C", ROOT, "--exclude=*.db", "--exclude=*.db-wal", "--exclude=*.db-shm", "data"])
		return { kind: "tar.gz", size: fs.statSync(target).size }
	} catch (e) {
		// На системе без tar лучше скопировать каталог, чем остаться без файлов вовсе.
		console.warn(`  tar недоступен (${e.message}) — копирую data/ как есть`)
		const copyTo = target.replace(/\.tar\.gz$/, "")
		fs.cpSync(DATA_DIR, copyTo, { recursive: true, filter: (src) => !/\.db(-wal|-shm)?$/.test(src) })
		return { kind: "directory", size: null }
	}
}

// ── Удаление устаревших копий ────────────────────────────────────────────────
function prune() {
	const all = fs
		.readdirSync(BACKUP_ROOT, { withFileTypes: true })
		// Закреплённые (.keep) не удаляем и в лимит не считаем
		.filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}(\d{2})?$/.test(e.name))
		.filter((e) => !fs.existsSync(path.join(BACKUP_ROOT, e.name, ".keep")))
		.map((e) => e.name)
		.sort()
	const extra = all.slice(0, Math.max(0, all.length - KEEP))
	for (const name of extra) {
		fs.rmSync(path.join(BACKUP_ROOT, name), { recursive: true, force: true })
		console.log(`  удалена устаревшая копия: ${name}`)
	}
	return { kept: Math.min(all.length, KEEP), removed: extra.length }
}

function main() {
	const conn = connection()
	const name = stamp()
	const dir = path.join(BACKUP_ROOT, name)

	console.log(`Резервное копирование`)
	console.log(`  база:    ${conn.label}`)
	console.log(`  каталог: ${dir}`)

	fs.mkdirSync(dir, { recursive: true })
	// В копии лежат персональные данные проживающих — доступ только владельцу.
	try {
		fs.chmodSync(BACKUP_ROOT, 0o700)
		fs.chmodSync(dir, 0o700)
	} catch {}

	const dumpFile = path.join(dir, "database.dump")
	// -Fc: сжатый формат, из которого pg_restore умеет доставать отдельные таблицы.
	run(tool("pg_dump"), [...conn.args, "--format=custom", "--no-owner", "--no-privileges", "--file", dumpFile], conn.env)

	// Проверяем, что дамп читается: оборванный файл лучше заметить сейчас, а не в аварии.
	const listing = run(tool("pg_restore"), ["--list", dumpFile])
	const tables = (listing.match(/TABLE DATA/g) || []).length
	const dumpSize = fs.statSync(dumpFile).size
	if (!dumpSize) throw new Error("pg_dump создал пустой файл")

	const files = archiveData(path.join(dir, "files.tar.gz"))

	const manifest = {
		created_at: new Date().toISOString(),
		note: process.env.BACKUP_NOTE || null,
		database: conn.label,
		tool: (run(tool("pg_dump"), ["--version"]) || "").trim(),
		node: process.version,
		database_dump: { file: "database.dump", size: dumpSize, sha256: sha256(dumpFile), tables_with_data: tables },
		files: files ? { file: files.kind === "tar.gz" ? "files.tar.gz" : "files/", ...files } : null,
		restore: `node scripts/restore.js ${path.relative(ROOT, dir).replace(/\\/g, "/")} --yes`,
	}
	fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2))
	try {
		fs.chmodSync(dumpFile, 0o600)
	} catch {}

	console.log(`  дамп базы:   ${mb(dumpSize)} (таблиц с данными: ${tables})`)
	if (files?.size) console.log(`  файлы data/: ${mb(files.size)}`)
	const { kept, removed } = prune()
	console.log(`  хранится копий: ${kept}${removed ? `, удалено: ${removed}` : ""}`)
	console.log("Готово.")
}

try {
	main()
} catch (e) {
	console.error("Резервное копирование не выполнено:", e.message)
	process.exit(1)
}
