// Минимальный загрузчик .env — без зависимостей.
// README с самого начала предлагал завести .env, но читать его было некому:
// переменные приходилось задавать в окружении вручную. Теперь файл действительно
// работает. Уже заданные переменные окружения приоритетнее файла: так systemd
// или docker-compose всегда перекрывают локальный .env, а не наоборот.
const fs = require("node:fs")
const path = require("node:path")

function loadEnv(file = path.join(__dirname, "..", ".env")) {
	let raw
	try {
		raw = fs.readFileSync(file, "utf8")
	} catch {
		return false // .env необязателен
	}
	for (const line of raw.split(/\r?\n/)) {
		const s = line.trim()
		if (!s || s.startsWith("#")) continue
		const eq = s.indexOf("=")
		if (eq < 1) continue
		const key = s.slice(0, eq).trim()
		let value = s.slice(eq + 1).trim()
		// Значение можно взять в кавычки, если внутри есть пробелы или #
		if (
			(value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
			(value.startsWith("'") && value.endsWith("'") && value.length > 1)
		) {
			value = value.slice(1, -1)
		}
		if (!(key in process.env)) process.env[key] = value
	}
	return true
}

module.exports = { loadEnv }
