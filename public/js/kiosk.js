const $ = (s) => document.querySelector(s)
const el = (tag, props = {}, ...kids) => {
	const n = Object.assign(document.createElement(tag), props)
	for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k))
	return n
}

const form = $("#kiosk-form")
const input = $("#kiosk-q")
const out = $("#kiosk-result")

form.addEventListener("submit", async (e) => {
	e.preventDefault()
	const q = input.value.trim()
	out.innerHTML = ""
	if (q.length < 2) return
	let matches
	try {
		matches = await (await fetch(`/api/kiosk/lookup?q=${encodeURIComponent(q)}`)).json()
	} catch {
		out.append(el("div", { className: "empty-note muted" }, "Ошибка соединения. Попробуйте ещё раз."))
		return
	}
	if (!matches.length) {
		out.append(el("div", { className: "empty-note muted" }, "Никого не найдено. Проверьте написание или обратитесь к коменданту."))
		return
	}
	if (matches.length === 1) return showResult(matches[0])

	out.append(el("p", { className: "map-title" }, "Найдено несколько — выберите себя:"))
	const list = el("div", { className: "pick-list" })
	matches.forEach((m) => {
		const item = el("button", { className: "pick-item", type: "button" }, el("div", {}, m.full_name), m.company ? el("small", {}, m.company) : "")
		item.onclick = () => showResult(m)
		list.append(item)
	})
	out.append(list)
})

function showResult(m) {
	out.innerHTML = ""
	if (!m.placement) {
		out.append(
			el("div", { className: "res-card" }, el("div", { className: "name" }, m.full_name), el("p", { className: "meta", style: "margin-top:1rem" }, "На сегодня активного размещения не найдено. Обратитесь к коменданту.")),
		)
		out.append(newSearchBtn())
		return
	}
	const p = m.placement
	const PERIOD = { now: "Вы проживаете здесь сейчас", upcoming: "Заезд запланирован", past: "Проживание завершено" }
	const card = el("div", { className: "res-card" })
	card.append(el("div", { className: "name" }, m.full_name))
	card.append(el("div", { className: "room-no" }, `№ ${p.room_number}`))
	card.append(el("p", { className: "meta" }, `${p.hotel_name}${p.floor != null ? `, этаж ${p.floor}` : ""} · ${p.bed_label}`))
	card.append(el("p", { className: "meta", style: "color:var(--color-secondary)" }, `Период: ${p.date_from} – ${p.date_to}`))
	if (PERIOD[p.period]) card.append(el("p", { className: "meta", style: "color:var(--color-secondary);margin-top:.25rem" }, PERIOD[p.period]))
	card.append(el("span", { className: "status", style: `background:${p.status_color}` }, p.status_name))
	out.append(card)

	if (m.floorRooms && m.floorRooms.length) {
		const mapCard = el("div", { className: "res-card", style: "text-align:left" })
		mapCard.append(el("p", { className: "map-title" }, `План · ${p.hotel_name}${p.floor != null ? `, этаж ${p.floor}` : ""}`))
		const grid = el("div", { className: "map-grid" })
		m.floorRooms.forEach((num) => {
			const isTarget = String(num) === String(p.room_number)
			const room = el("div", { className: `map-room${isTarget ? " target" : ""}` }, `№ ${num}`)
			if (isTarget) room.append(el("span", { className: "pin" }, "▼ ваш номер"))
			grid.append(room)
		})
		mapCard.append(grid)
		out.append(mapCard)
	}
	out.append(newSearchBtn())
}

function newSearchBtn() {
	const wrap = el("div", { style: "text-align:center" })
	const b = el("button", { className: "btn", textContent: "Новый поиск" })
	b.onclick = () => {
		out.innerHTML = ""
		input.value = ""
		input.focus()
	}
	wrap.append(b)
	return wrap
}
