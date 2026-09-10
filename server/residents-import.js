// Разбор кадровой выгрузки в список проживающих.
//
// Логика вынесена из обработчика запроса, потому что она самая капризная во всём
// импорте и её нужно проверять на настоящих файлах, а не через HTTP.
// На вход подаются уже «плоские» данные: строка заголовков и строки значений,
// поэтому модуль ничего не знает ни про ExcelJS, ни про базу.

// ФИО: 2–4 слова кириллицей. По этому же признаку строка отбраковывается при импорте,
// чтобы в список не попали итоговые строки вроде «Всего: 53».
const isFio = (v) => {
	const parts = String(v || "").trim().split(/\s+/).filter(Boolean)
	return parts.length >= 2 && parts.length <= 4 && parts.every((p) => /^[А-Яа-яЁё][А-Яа-яЁё-]+$/.test(p))
}

// Табельный номер: только цифры. Пробелы внутри встречаются в выгрузках из 1С.
const isTab = (v) => /^[0-9]{3,12}$/.test(String(v || "").replace(/\s/g, ""))

// «ИВАНОВ ИВАН ИВАНОВИЧ» и «Иванов Иван Иванович» — один и тот же человек, но в
// списках и отчётах верхний регистр выглядит криком. Приводим к одному виду,
// сохраняя дефисные фамилии (Петров-Водкин).
const titleCase = (v) =>
	String(v || "")
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.map((word) =>
			word
				.split("-")
				.map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
				.join("-"),
		)
		.join(" ")

const FIELD_KEYWORDS = {
	company: ["орган", "компан", "балансов", "предприят", "работодат", "company"],
	department: ["подразд", "отдел", "департам", "служб", "участок", "цех", "department"],
	position: ["должн", "профес", "position"],
	phone: ["тел", "phone", "моб"],
	note: ["примеч", "коммент", "note"],
}
const NAME_KEYWORDS = ["фио", "ф.и.о", "имя", "работник", "сотрудник", "name"]
const TAB_KEYWORDS = ["таб", "tab", "personnel"]

/**
 * Определяет, в каких колонках что лежит.
 *
 * Заголовок — только подсказка: в кадровых выгрузках он регулярно разъезжается с
 * содержимым. В файле заказчика колонка «Табельный номер» содержит ФИО, а сам
 * табельный лежит под «Таб.№», и обе подходят под ключевое слово «таб». Поэтому
 * для ФИО и табельного заголовок принимается только если данные его подтверждают,
 * иначе колонка выбирается по содержимому.
 *
 * @param {string[]} headers строка заголовков (индекс = номер колонки, с нуля)
 * @param {string[][]} rows строки данных
 * @returns {{name:number, tab:number, company:number, department:number, position:number, phone:number, note:number}}
 *          индексы колонок с нуля, -1 — не найдено
 */
function detectColumns(headers, rows) {
	const width = Math.max(headers.length, ...rows.map((r) => r.length), 0)
	const lower = headers.map((h) => String(h || "").toLowerCase())
	const sample = rows.slice(0, 50)

	const shareOf = (col, test) => {
		const values = sample.map((r) => String(r[col] ?? "").trim()).filter(Boolean)
		if (!values.length) return 0
		return values.filter(test).length / values.length
	}

	const fioShare = []
	const tabShare = []
	for (let c = 0; c < width; c++) {
		fioShare[c] = shareOf(c, isFio)
		tabShare[c] = shareOf(c, isTab)
	}

	const byHeader = (keys) => lower.findIndex((h) => h && keys.some((k) => h.includes(k)))
	const allByHeader = (keys) =>
		lower.map((h, i) => (h && keys.some((k) => h.includes(k)) ? i : -1)).filter((i) => i >= 0)
	const bestBy = (scores, taken) => {
		let best = -1
		for (let c = 0; c < width; c++) {
			if (taken.includes(c)) continue
			if (scores[c] >= 0.5 && (best === -1 || scores[c] > scores[best])) best = c
		}
		return best
	}

	let name = byHeader(NAME_KEYWORDS)
	if (name < 0 || fioShare[name] < 0.5) name = bestBy(fioShare, [])

	// Табельный номер бывает и с буквами («В-101», «A-1001»), поэтому проверка по
	// содержимому здесь только отсеивающая: из колонок с подходящим заголовком
	// выбрасываем те, где на самом деле лежит ФИО (как в выгрузке заказчика, где
	// под «Табельный номер» записаны фамилии), а среди оставшихся предпочитаем
	// числовую. Если заголовок не помог — ищем чисто по содержимому.
	const tabCandidates = allByHeader(TAB_KEYWORDS).filter((c) => c !== name && fioShare[c] < 0.5)
	let tab = tabCandidates.find((c) => tabShare[c] >= 0.5)
	if (tab === undefined) tab = tabCandidates.length ? tabCandidates[0] : bestBy(tabShare, [name])

	const pick = (keys) => {
		const c = byHeader(keys)
		return c === name || c === tab ? -1 : c
	}

	return {
		name,
		tab,
		company: pick(FIELD_KEYWORDS.company),
		department: pick(FIELD_KEYWORDS.department),
		position: pick(FIELD_KEYWORDS.position),
		phone: pick(FIELD_KEYWORDS.phone),
		note: pick(FIELD_KEYWORDS.note),
	}
}

module.exports = { detectColumns, isFio, isTab, titleCase }
