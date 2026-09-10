#!/usr/bin/env node
// Восстановление NochOtel из резервной копии.
//
//   node scripts/restore.js backups/2026-09-09_0300          — что будет сделано
//   node scripts/restore.js backups/2026-09-09_0300 --yes     — выполнить
//   node scripts/restore.js backups/2026-09-09_0300 --yes --db-only
//
// Операция разрушающая: содержимое текущей базы заменяется данными из копии.
// Поэтому без --yes скрипт только показывает план и ничего не трогает.
require("../server/env").loadEnv()

const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { spawnSync } = require("node:child_process")

const ROOT = path.join(__dirname, "..")
const DATA_DIR = path.join(ROOT, "data")

const args = process.argv.slice(2)
const confirmed = args.includes("--yes")
const dbOnly = args.includes("--db-only")
const filesOnly = args.includes("--files-only")
const target = args.find((a) => !a.startsWith("--"))

if (!target) {
	console.error("Укажите каталог копии, например: node scripts/restore.js backups/2026-09-09_0300 --yes")
	process.exit(1)
}
const dir = path.resolve(ROOT, target)
if (!fs.existsSync(dir)) {
	console.error(`Каталог копии не найден: ${dir}`)
	process.exit(1)
}

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

function safeUrl(url) {
	try {
		const u = new URL(url)
		if (u.password) u.password = "***"
		return u.toString()
	} catch {
		return "postgresql://***"
	}
}

const tool = (name) => (process.env.PG_BIN ? path.join(process.env.PG_BIN, name) : name)

function run(cmd, cmdArgs, extraEnv = {}, allowFailure = false) {
	const r = spawnSync(cmd, cmdArgs, { env: { ...process.env, ...extraEnv }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
	if (r.error && r.error.code === "ENOENT") {
		throw new Error(`не найдена программа «${cmd}». Установите клиент PostgreSQL или задайте PG_BIN.`)
	}
	if (r.status !== 0 && !allowFailure) {
		throw new Error(`${cmd} завершился с кодом ${r.status}: ${(r.stderr || "").trim()}`)
	}
	return r
}

const dumpFile = path.join(dir, "database.dump")
const filesArchive = path.join(dir, "files.tar.gz")
const filesDir = path.join(dir, "files")
const manifestFile = path.join(dir, "manifest.json")
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : null
const conn = connection()

console.log("Восстановление NochOtel из копии")
console.log(`  копия:  ${dir}`)
if (manifest) console.log(`  снята:  ${manifest.created_at} (${manifest.database})`)
console.log(`  в базу: ${conn.label}`)

// Целостность дампа проверяем до того, как что-либо удалять.
if (!filesOnly) {
	if (!fs.existsSync(dumpFile)) throw new Error(`в копии нет файла database.dump`)
	if (manifest?.database_dump?.sha256) {
		const actual = crypto.createHash("sha256").update(fs.readFileSync(dumpFile)).digest("hex")
		if (actual !== manifest.database_dump.sha256) {
			console.error("Контрольная сумма дампа не совпадает с манифестом — файл повреждён. Восстановление отменено.")
			process.exit(1)
		}
		console.log("  контрольная сумма дампа совпадает")
	}
}

if (!confirmed) {
	console.log("")
	console.log("Будет сделано:")
	if (!filesOnly) console.log("  • существующие таблицы NochOtel удалены и созданы заново из дампа")
	if (!dbOnly && (fs.existsSync(filesArchive) || fs.existsSync(filesDir))) {
		console.log("  • каталог data/ заменён содержимым копии (текущий сохранится как data.before-restore-…)")
	}
	console.log("")
	console.log("Это уничтожит текущие данные. Остановите сервер и повторите с флагом --yes.")
	process.exit(0)
}

if (!filesOnly) {
	console.log("  восстанавливаю базу…")
	// --clean --if-exists: pg_restore сам удалит существующие объекты перед заливкой.
	// Часть предупреждений (нет прав на COMMENT ON EXTENSION и т.п.) — норма, поэтому
	// код возврата не считаем фатальным, но stderr показываем.
	const r = run(
		tool("pg_restore"),
		[...conn.args, "--clean", "--if-exists", "--no-owner", "--no-privileges", "--single-transaction", dumpFile],
		conn.env,
		true,
	)
	if (r.status !== 0) {
		console.error((r.stderr || "").trim())
		throw new Error("pg_restore не смог восстановить базу — данные не изменены (заливка шла одной транзакцией)")
	}
	console.log("  база восстановлена")
}

if (!dbOnly) {
	const hasArchive = fs.existsSync(filesArchive)
	const hasDir = fs.existsSync(filesDir)
	if (hasArchive || hasDir) {
		// Текущий data/ не удаляем, а отодвигаем: если в копии чего-то не хватает,
		// файлы можно достать вручную.
		if (fs.existsSync(DATA_DIR)) {
			const aside = `${DATA_DIR}.before-restore-${Date.now()}`
			fs.renameSync(DATA_DIR, aside)
			console.log(`  прежний data/ сохранён: ${path.basename(aside)}`)
		}
		if (hasArchive) run("tar", ["-xzf", filesArchive, "-C", ROOT])
		else fs.cpSync(filesDir, DATA_DIR, { recursive: true })
		console.log("  файлы data/ восстановлены")
	} else {
		console.log("  файлов в копии нет — пропускаю")
	}
}

console.log("Готово. Запустите сервер: npm start")
