// Даты в приложении — строки «ГГГГ-ММ-ДД» по местному времени пользователя.
// new Date().toISOString() отдаёт UTC: восточнее Гринвича «сегодня» до утра
// превращалось во вчера, и фильтры открывались не на тот день.

export function ymd(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export const today = () => ymd(new Date())

export function addDays(date, n) {
	const [y, m, d] = String(date).split("-").map(Number)
	return ymd(new Date(y, m - 1, d + n))
}

// Период брони полуоткрытый: с date_from по date_to − 1. В день выезда место уже свободно.
export function nightsBetween(from, to) {
	const n = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000)
	return Number.isFinite(n) ? n : 0
}

export function nightsWord(n) {
	const t = Math.abs(n) % 100
	if (t >= 11 && t <= 14) return "ночей"
	return [, "ночь", "ночи", "ночи", "ночи"][t % 10] || "ночей"
}

// «2026-09-07» → «07.09.2026» — для показа человеку
export const dm = (d) => (d ? String(d).split("-").reverse().join(".") : "")

// Метки времени из БД — «ГГГГ-ММ-ДД ЧЧ:ММ:СС» в UTC → местное время человека
export function dateTime(d, opts = { dateStyle: "medium", timeStyle: "short" }) {
	return d ? new Date(String(d).replace(" ", "T") + "Z").toLocaleString("ru-RU", opts) : ""
}
