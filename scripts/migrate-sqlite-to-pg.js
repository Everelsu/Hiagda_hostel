#!/usr/bin/env node
// Разовый перенос данных из старой базы SQLite в PostgreSQL.
//
//   node scripts/migrate-sqlite-to-pg.js                    — показать план
//   node scripts/migrate-sqlite-to-pg.js --yes              — перенести
//   node scripts/migrate-sqlite-to-pg.js --yes --source data/nochotel.db
//
// Идентификаторы (id) сохраняются: ссылки между таблицами, номера броней и уже
// выданные учётки остаются прежними. После заливки счётчики id подводятся к максимуму,
// иначе первая же новая запись столкнулась бы с существующей.
//
// Читать SQLite умеет встроенный модуль node:sqlite (Node 22.5+), поэтому отдельный
// драйвер ставить не нужно — better-sqlite3 из зависимостей проекта удалён.
require("../server/env").loadEnv()

const path = require("node:path")
const fs = require("node:fs")

let DatabaseSync
try {
	;({ DatabaseSync } = require("node:sqlite"))
} catch {
	console.error("Нужен Node.js 22.5 или новее: перенос читает старую базу встроенным модулем node:sqlite.")
	console.error(`Текущая версия: ${process.version}`)
	process.exit(1)
}

const db = require("../server/db")

const args = process.argv.slice(2)
const confirmed = args.includes("--yes")
const srcArg = args[args.indexOf("--source") + 1]
const SOURCE = path.resolve(
	process.cwd(),
	args.includes("--source") && srcArg ? srcArg : process.env.NOCHOTEL_DB || path.join(__dirname, "..", "data", "nochotel.db"),
)

// Порядок важен: родительские таблицы заливаются раньше тех, что на них ссылаются.
const TABLES = [
	"residents",
	"hotels",
	"room_classes",
	"statuses",
	"amenities",
	"rooms",
	"beds",
	"users",
	"placements",
	"room_amenities",
	"hotel_amenities",
	"places",
	"images",
	"reviews",
	"room_blocks",
	"room_issues",
	"plan_shapes",
	"audit_log",
	"announcements",
	"issue_comments",
	"hotel_info_sections",
]

async function targetColumns(table) {
	const rows = await db
		.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?")
		.all(table)
	return new Set(rows.map((r) => r.column_name))
}

async function main() {
	if (!fs.existsSync(SOURCE)) {
		console.error(`Файл старой базы не найден: ${SOURCE}`)
		console.error("Укажите путь явно: --source путь/к/nochotel.db")
		process.exit(1)
	}
	await db.ready

	const src = new DatabaseSync(SOURCE, { readOnly: true })
	const existingSrc = new Set(
		src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
	)

	console.log(`Перенос данных в PostgreSQL`)
	console.log(`  источник: ${SOURCE}`)

	// Системные состояния «Свободно» и «Ремонт» создаёт сама схема при первом
	// подключении, поэтому таблица statuses пустой не бывает никогда. Считать их
	// «уже имеющимися данными» нельзя — иначе перенос отказывался бы работать всегда.
	const OCCUPANCY_FILTER = {
		statuses: "WHERE code IS DISTINCT FROM 'free' AND code IS DISTINCT FROM 'repair'",
	}

	const plan = []
	for (const table of TABLES) {
		if (!existingSrc.has(table)) continue
		const count = src.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c
		const already = (await db.prepare(`SELECT COUNT(*) c FROM ${table} ${OCCUPANCY_FILTER[table] || ""}`).get()).c
		if (count || already) plan.push({ table, count, already })
	}

	console.log("")
	console.log("  таблица                 в SQLite   уже в PostgreSQL")
	for (const p of plan) {
		console.log(`  ${p.table.padEnd(22)} ${String(p.count).padStart(8)} ${String(p.already).padStart(18)}`)
	}
	console.log("")

	const occupied = plan.filter((p) => p.already > 0)
	if (occupied.length) {
		console.error("В целевой базе уже есть данные: " + occupied.map((p) => `${p.table} (${p.already})`).join(", "))
		console.error("Перенос рассчитан на пустую базу. Очистите её или заведите новую и повторите.")
		process.exit(1)
	}

	if (!confirmed) {
		console.log("Это предварительный просмотр. Для переноса добавьте флаг --yes.")
		return
	}

	let total = 0
	await db.tx(async (t) => {
		// Автосозданные системные состояния убираем: свои, вместе с исходными id,
		// приедут из SQLite, а ссылаться на удаляемые пока некому — база пуста.
		await t.prepare("DELETE FROM statuses WHERE kind = 'system'").run()

		for (const { table, count } of plan) {
			if (!count) continue
			const tCols = await targetColumns(table)
			const srcCols = src
				.prepare(`PRAGMA table_info(${table})`)
				.all()
				.map((c) => c.name)
			// Переносим только те колонки, которые есть с обеих сторон: старые базы могут
			// не знать про department, а лишних полей в SQLite быть не должно.
			const cols = srcCols.filter((c) => tCols.has(c))
			const skipped = srcCols.filter((c) => !tCols.has(c))
			if (skipped.length) console.log(`  ${table}: пропускаю колонки ${skipped.join(", ")}`)

			const placeholders = cols.map(() => "?").join(",")
			const ins = t.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`)
			const rows = src.prepare(`SELECT ${cols.join(", ")} FROM ${table}`).all()
			for (const row of rows) {
				await ins.run(...cols.map((c) => (row[c] === undefined ? null : row[c])))
			}
			console.log(`  ${table.padEnd(22)} перенесено: ${rows.length}`)
			total += rows.length
		}

		// Счётчики id: без этого следующая вставка получила бы id = 1 и упала на дубликате.
		for (const { table } of plan) {
			const tCols = await targetColumns(table)
			if (!tCols.has("id")) continue
			await t.query(
				`SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`,
				[table],
			)
		}
	})

	src.close()
	console.log("")
	console.log(`Готово. Перенесено записей: ${total}`)
	console.log("Проверьте вход в систему и календарь броней, затем снимите первую копию: npm run backup")
}

main()
	.catch((e) => {
		console.error("Перенос не выполнен:", e.message)
		process.exitCode = 1
	})
	.finally(() => db.close())
