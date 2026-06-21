const S = {
	token: localStorage.getItem("noch_token") || null,
	user: JSON.parse(localStorage.getItem("noch_user") || "null"),
	hotels: [],
	classes: [],
	statuses: [],
	rooms: [],
	placements: {},
}

const $ = (sel) => document.querySelector(sel)
const el = (tag, props = {}, ...kids) => {
	const n = Object.assign(document.createElement(tag), props)
	for (const k of kids.flat()) n.append(k?.nodeType ? k : document.createTextNode(k ?? ""))
	return n
}
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 }
const can = (role) => S.user && ROLE_RANK[S.user.role] >= ROLE_RANK[role]
const isFreeStatus = (n) => /свобод/i.test(n || "")

async function api(pathName, opts = {}) {
	const res = await fetch(`/api${pathName}`, {
		...opts,
		headers: {
			...(opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
			...(S.token ? { Authorization: `Bearer ${S.token}` } : {}),
			...(opts.headers || {}),
		},
	})
	if (res.status === 401) return logout()
	if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Ошибка запроса")
	return res
}
const apiJson = (p, o) => api(p, o).then((r) => r.json())

function toast(msg) {
	const t = el("div", { className: "toast", textContent: msg })
	document.body.append(t)
	setTimeout(() => t.remove(), 2500)
}

function fmt(d) {
	return d.toISOString().slice(0, 10)
}
function parse(s) {
	return new Date(`${s}T00:00:00`)
}
function eachDay(from, to) {
	const out = []
	for (let d = parse(from); d <= parse(to); d.setDate(d.getDate() + 1)) out.push(new Date(d))
	return out
}

/* ---------- тема ---------- */
const THEMES = ["dark", "light"]
const THEME_ICON = { dark: "moon", light: "sun" }
const THEME_LABEL = { dark: "Тёмная тема", light: "Светлая тема" }
function applyTheme(t) {
	document.documentElement.setAttribute("data-theme", t)
	localStorage.setItem("noch_theme", t)
	const ico = document.querySelector("#btn-theme .ico")
	const label = $("#theme-label")
	if (ico) ico.innerHTML = iconSvg(THEME_ICON[t])
	if (label) label.textContent = THEME_LABEL[t]
}
hydrateIcons()
const savedTheme = localStorage.getItem("noch_theme")
applyTheme(THEMES.includes(savedTheme) ? savedTheme : "dark")
$("#btn-theme").addEventListener("click", () => {
	const cur = document.documentElement.getAttribute("data-theme")
	applyTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length])
})

/* ---------- auth / первичная настройка ---------- */
let setupMode = false
async function checkSetup() {
	try {
		const { needsSetup } = await (await fetch("/api/setup-status")).json()
		setupMode = needsSetup
	} catch {
		setupMode = false
	}
	$("#reg-extra").classList.toggle("hidden", !setupMode)
	$("#login-submit").textContent = setupMode ? "Создать администратора" : "Войти"
	$("#login-subtitle").textContent = setupMode
		? "Первый запуск: создайте учётную запись администратора"
		: "Учёт номерного фонда вахтовых гостиниц"
}
checkSetup()

$("#login-form").addEventListener("submit", async (e) => {
	e.preventDefault()
	$("#login-err").textContent = ""
	try {
		const endpoint = setupMode ? "/api/register-admin" : "/api/login"
		const body = {
			username: $("#login-username").value,
			password: $("#login-password").value,
		}
		if (setupMode) body.full_name = $("#login-fullname").value
		const r = await fetch(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		if (!r.ok) throw new Error((await r.json()).error)
		const data = await r.json()
		S.token = data.token
		S.user = data.user
		localStorage.setItem("noch_token", S.token)
		localStorage.setItem("noch_user", JSON.stringify(S.user))
		boot()
	} catch (err) {
		$("#login-err").textContent = err.message
	}
})

function logout() {
	S.token = null
	S.user = null
	localStorage.removeItem("noch_token")
	localStorage.removeItem("noch_user")
	$("#app").classList.add("hidden")
	$("#login").classList.remove("hidden")
}
$("#btn-logout").addEventListener("click", logout)

/* ---------- boot ---------- */
async function boot() {
	$("#login").classList.add("hidden")
	$("#app").classList.remove("hidden")
	const ROLE_LABEL = { admin: "Администратор", editor: "Редактирование", viewer: "Просмотр" }
	$("#user-name").textContent = S.user.full_name || S.user.username
	$("#user-role").textContent = ROLE_LABEL[S.user.role] || S.user.role
	document.querySelectorAll(".admin-only").forEach((n) => n.classList.toggle("hidden", !can("admin")))
	document.querySelectorAll(".editor-only").forEach((n) => n.classList.toggle("hidden", !can("editor")))

	const today = new Date()
	const end = new Date()
	end.setDate(end.getDate() + 13)
	$("#f-from").value = fmt(today)
	$("#f-to").value = fmt(end)

	S.hotels = await apiJson("/hotels")
	S.classes = await apiJson("/classes")
	S.statuses = await apiJson("/statuses")

	const hotelItems = S.hotels.map((h) => ({ value: h.id, label: h.name }))
	$("#f-hotel").setItems(hotelItems)
	$("#plan-hotel").setItems(hotelItems)
	$("#f-class").setItems([{ value: "", label: "Все" }, ...S.classes.map((c) => ({ value: c.id, label: c.name }))])
	$("#jr-hotel").setItems([{ value: "", label: "Все" }, ...hotelItems])
	$("#mv-date").value = fmt(new Date())
	$("#plan-date").value = fmt(new Date())

	renderLegend()
	refreshGrid()
	showView("dashboard")
}

/* ---------- замена нативных контролов на кастомные ---------- */
function replaceCtl(id, comp) {
	const old = document.getElementById(id)
	comp.id = id
	old.replaceWith(comp)
	return comp
}
function setupControls() {
	const today = fmt(new Date())
	replaceCtl("f-hotel", makeSelect([], null))
	replaceCtl("f-class", makeSelect([{ value: "", label: "Все" }], ""))
	replaceCtl("jr-hotel", makeSelect([{ value: "", label: "Все" }], ""))
	replaceCtl("plan-hotel", makeSelect([], null))
	replaceCtl("f-from", makeDatePicker(today))
	replaceCtl("f-to", makeDatePicker(today))
	replaceCtl("mv-date", makeDatePicker(today))
	replaceCtl("plan-date", makeDatePicker(today))
	const back = new Date()
	back.setMonth(back.getMonth() - 6)
	const fwd = new Date()
	fwd.setMonth(fwd.getMonth() + 6)
	replaceCtl("jr-from", makeDatePicker(fmt(back)))
	replaceCtl("jr-to", makeDatePicker(fmt(fwd)))
}
setupControls()

;["#f-hotel", "#f-class", "#f-from", "#f-to"].forEach((id) =>
	$(id).addEventListener("change", refreshGrid),
)

/* ---------- переключение экранов ---------- */
const VIEW_RENDER = {
	dashboard: renderDashboard,
	plan: renderPlan,
	movements: renderMovements,
	journal: renderJournal,
	summary: renderSummary,
	audit: renderAudit,
}
function showView(name) {
	document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hidden", v.id !== `view-${name}`))
	document.querySelectorAll(".nav-item[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === name))
	VIEW_RENDER[name]?.()
}
document.querySelectorAll(".nav-item[data-view]").forEach((b) => {
	b.addEventListener("click", () => showView(b.dataset.view))
})
$("#mv-date").addEventListener("change", renderMovements)
$("#jr-q").addEventListener("input", debounce(renderJournal, 300))
$("#jr-hotel").addEventListener("change", renderJournal)
$("#plan-hotel").addEventListener("change", renderPlan)
$("#plan-date").addEventListener("change", renderPlan)
$("#jr-from").addEventListener("change", renderJournal)
$("#jr-to").addEventListener("change", renderJournal)
$("#jr-print").addEventListener("click", printRegistrationBook)

function debounce(fn, ms) {
	let t
	return (...a) => {
		clearTimeout(t)
		t = setTimeout(() => fn(...a), ms)
	}
}

function dataTable(columns, rows, renderRow) {
	const table = el("table", { className: "data-table" })
	const thead = el("thead")
	const hr = el("tr")
	columns.forEach((c) => hr.append(el("th", {}, c)))
	thead.append(hr)
	const tb = el("tbody")
	rows.forEach((r) => tb.append(renderRow(r)))
	table.append(thead, tb)
	return table
}
const statusCell = (name, color) =>
	el("td", {}, el("span", { className: "status-dot", style: `background:${color}` }), name)

async function renderMovements() {
	const date = $("#mv-date").value || fmt(new Date())
	const data = await apiJson(`/movements?date=${date}`)
	const body = $("#movements-body")
	body.innerHTML = ""
	const block = (title, rows) => {
		const wrap = el("div", {})
		wrap.append(el("div", { className: "section-title" }, title, el("span", { className: "count" }, String(rows.length))))
		if (!rows.length) {
			wrap.append(el("div", { className: "empty-note" }, "Нет записей на эту дату."))
		} else {
			wrap.append(
				dataTable(["Гость", "Гостиница", "Номер", "Место", "Период", "Статус"], rows, (r) =>
					el(
						"tr",
						{},
						el("td", {}, r.resident_name || "—"),
						el("td", {}, r.hotel_name),
						el("td", {}, r.room_number),
						el("td", {}, r.bed_label),
						el("td", {}, `${r.date_from} – ${r.date_to}`),
						statusCell(r.status_name, r.status_color),
					),
				),
			)
		}
		return wrap
	}
	body.append(block("Заезды", data.arrivals), block("Выезды", data.departures))
}

let journalRows = []
async function renderJournal() {
	const q = $("#jr-q").value.trim()
	const hotel = $("#jr-hotel").value
	const from = $("#jr-from").value
	const to = $("#jr-to").value
	const params = new URLSearchParams()
	if (q) params.set("q", q)
	if (hotel) params.set("hotel_id", hotel)
	if (from && to) {
		params.set("from", from)
		params.set("to", to)
	}
	journalRows = await apiJson(`/journal?${params}`)
	const body = $("#journal-body")
	body.innerHTML = ""
	if (!journalRows.length) {
		body.append(el("div", { className: "empty-note" }, "Размещений не найдено."))
		return
	}
	body.append(
		dataTable(["Гость", "Гостиница", "Номер", "Место", "Заезд", "Выезд", "Статус"], journalRows, (r) =>
			el(
				"tr",
				{},
				el("td", {}, r.resident_name || "—"),
				el("td", {}, r.hotel_name),
				el("td", {}, r.room_number),
				el("td", {}, r.bed_label),
				el("td", {}, r.date_from),
				el("td", {}, r.date_to),
				statusCell(r.status_name, r.status_color),
			),
		),
	)
}

function printRegistrationBook() {
	const hotelName = S.hotels.find((h) => String(h.id) === String($("#jr-hotel").value))?.name || "Все гостиницы"
	const meta = [`Гостиница: ${hotelName}`, `Период: ${$("#jr-from").value} – ${$("#jr-to").value}`, `Записей: ${journalRows.length}`]
	const rows = journalRows.map((r, i) => [i + 1, r.resident_name || "—", r.hotel_name, r.room_number, r.bed_label, r.date_from, r.date_to, r.status_name])
	openPrint("Книга регистрации проживающих", meta, ["№", "ФИО", "Гостиница", "Номер", "Место", "Заезд", "Выезд", "Статус"], rows)
}

function openPrint(title, metaLines, columns, rows) {
	const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))
	const head = `<tr>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`
	const body = rows.length
		? rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")
		: `<tr><td colspan="${columns.length}" style="text-align:center;color:#666">Нет данных</td></tr>`
	const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
	body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:24px}
	h1{font-size:18px;margin:0 0 6px}
	.meta{color:#444;font-size:12px;margin-bottom:14px}
	.meta span{margin-right:14px}
	table{border-collapse:collapse;width:100%;font-size:12px}
	th,td{border:1px solid #999;padding:5px 8px;text-align:left;vertical-align:top}
	th{background:#eee}
	.org{font-size:13px;font-weight:bold;margin-bottom:2px}
	.sign{margin-top:28px;font-size:12px}
	.noprint{margin-top:18px}
	@media print{.noprint{display:none}}
</style></head><body>
	<div class="org">АО «Хиагда»</div>
	<h1>${esc(title)}</h1>
	<div class="meta">${metaLines.map((m) => `<span>${esc(m)}</span>`).join("")}</div>
	<table><thead>${head}</thead><tbody>${body}</tbody></table>
	<div class="sign">Ответственный: ______________________ / ____________________ &nbsp;&nbsp;&nbsp; Дата: ______________</div>
	<button class="noprint" onclick="window.print()" style="padding:8px 16px;font-size:14px;cursor:pointer">Печать / Сохранить в PDF</button>
</body></html>`
	const w = window.open("", "_blank")
	if (!w) return toast("Разрешите всплывающие окна для печати")
	w.document.write(html)
	w.document.close()
}

async function renderDashboard() {
	const d = await apiJson("/dashboard")
	const body = $("#dashboard-body")
	body.innerHTML = ""

	const t = d.totals
	const stats = el("div", { className: "stats", style: "padding:0" })
	;[["Гостиниц", t.hotels], ["Номеров", t.rooms], ["Мест всего", t.beds], ["Занято сегодня", t.occupied], ["Свободно", t.free], ["Загрузка", `${t.load}%`]].forEach(([l, v]) =>
		stats.append(el("div", { className: "stat-card" }, el("div", { className: "value" }, String(v)), el("p", { className: "label" }, l))),
	)
	body.append(stats)

	const actions = el("div", { className: "quick-actions" })
	const act = (label, icon, fn) => {
		const b = el("button", { className: "btn" }, iconEl(icon), label)
		b.onclick = fn
		actions.append(b)
	}
	act("Шахматка", "calendar", () => showView("rack"))
	act("План размещения", "layout", () => showView("plan"))
	if (can("editor")) act("Добавить номер", "key", () => roomModal(null))
	if (can("editor")) act("Импорт из Excel", "upload", () => $("#btn-import").click())
	body.append(actions)

	const cols = el("div", { className: "dash-cols" })

	const todayPanel = el("div", { className: "panel" })
	const miniList = (title, rows) => {
		const wrap = el("div", { style: "margin-bottom:var(--gap-lg)" })
		wrap.append(el("div", { className: "section-title" }, title, el("span", { className: "count" }, String(rows.length))))
		if (!rows.length) wrap.append(el("div", { className: "muted", style: "font-size:var(--font-size-sm)" }, "Нет записей."))
		else rows.forEach((r) => wrap.append(el("div", { className: "mini-row" }, el("span", { className: "who" }, r.resident_name || "—"), el("span", { className: "where" }, `${r.hotel_name}, № ${r.room_number} · ${r.bed_label}`))))
		return wrap
	}
	todayPanel.append(el("div", { className: "section-title" }, `Сегодня · ${d.date}`))
	todayPanel.append(miniList("Заезды", d.arrivals), miniList("Выезды", d.departures))

	const occPanel = el("div", { className: "panel" })
	occPanel.append(el("div", { className: "section-title" }, "Загрузка по гостиницам"))
	if (!d.hotels.length) occPanel.append(el("div", { className: "muted" }, "Нет гостиниц."))
	d.hotels.forEach((h) => {
		const row = el("div", { style: "margin-bottom:var(--gap-md)" })
		row.append(el("div", { className: "row", style: "display:flex;justify-content:space-between;font-size:var(--font-size-sm)" }, el("span", {}, h.name), el("b", {}, `${h.occupied}/${h.beds} · ${h.load}%`)))
		const track = el("div", { className: "bar-track" })
		track.append(el("div", { className: "bar-fill", style: `width:${h.load}%` }))
		row.append(track)
		occPanel.append(row)
	})

	cols.append(todayPanel, occPanel)
	body.append(cols)
}

async function renderPlan() {
	const hotel = $("#plan-hotel").value
	const date = $("#plan-date").value || fmt(new Date())
	const body = $("#plan-body")
	if (!hotel) {
		body.innerHTML = ""
		body.append(el("div", { className: "empty-note" }, "Выберите гостиницу."))
		return
	}
	const { rooms } = await apiJson(`/plan?hotel_id=${hotel}&date=${date}`)
	body.innerHTML = ""
	if (!rooms.length) {
		body.append(el("div", { className: "empty-note" }, "В гостинице нет номеров."))
		return
	}
	const floors = {}
	for (const r of rooms) (floors[r.floor ?? "—"] ||= []).push(r)
	for (const floor of Object.keys(floors)) {
		const wrap = el("div", { className: "plan-floor" })
		wrap.append(el("div", { className: "section-title" }, `Этаж ${floor}`, el("span", { className: "count" }, `${floors[floor].length} ном.`)))
		const grid = el("div", { className: "plan-grid" })
		for (const room of floors[floor]) {
			const cls = room.occupied === 0 ? "free" : room.occupied >= room.capacity ? "full" : "part"
			const tile = el("div", { className: `room-tile ${cls}` })
			tile.title = room.beds
				.map((b) => `${b.label}: ${b.placement ? `${b.placement.resident_name || b.placement.status_name}` : "свободно"}`)
				.join("\n")
			tile.append(el("div", { className: "rt-num" }, `№ ${room.number}`))
			tile.append(el("div", { className: "rt-cls" }, `${room.class_name || "—"} · ${room.occupied}/${room.capacity}`))
			const beds = el("div", { className: "rt-beds" })
			room.beds.forEach((b) => beds.append(el("span", { className: "rt-bed", style: b.placement ? `background:${b.placement.status_color}` : "" })))
			tile.append(beds)
			tile.onclick = () => roomPlanModal(room, date)
			grid.append(tile)
		}
		wrap.append(grid)
		body.append(wrap)
	}
}

function roomPlanModal(room, date) {
	const listWrap = el("div", { className: "list" })
	room.beds.forEach((b) => {
		const p = b.placement
		const info = p
			? el("span", { className: "grow" }, el("span", { className: "swatch", style: `background:${p.status_color};margin-right:6px` }), `${b.label} — ${p.resident_name || p.status_name} (${p.date_from} – ${p.date_to})`)
			: el("span", { className: "grow muted" }, `${b.label} — свободно`)
		const li = el("div", { className: "li" }, info)
		if (can("editor")) {
			const act = el("button", { className: "btn btn-transparent btn-sm icon-only", title: p ? "Изменить" : "Заселить" }, iconEl(p ? "pencil" : "plus"))
			act.onclick = () => {
				close()
				placementModal(b, p, date, () => {
					apiJson(`/plan?hotel_id=${room.hotel_id}&date=${date}`).then(() => renderPlan())
				})
			}
			li.append(act)
		}
		listWrap.append(li)
	})
	const close = modal(
		`Номер № ${room.number} · ${room.class_name || "—"}`,
		[el("p", { className: "muted", style: "margin:0" }, `Занято ${room.occupied} из ${room.capacity} на ${date}`), listWrap],
		[el("button", { className: "btn btn-primary", textContent: "Закрыть", onclick: () => close() })],
	)
}

async function renderSummary() {
	const data = await apiJson("/summary")
	const body = $("#summary-body")
	body.innerHTML = ""
	if (!data.length) {
		body.append(el("div", { className: "empty-note" }, "Нет гостиниц."))
		return
	}
	const grid = el("div", { className: "summary-grid" })
	data.forEach((h) => {
		const card = el("div", { className: "summary-card" })
		card.append(el("h3", {}, h.name))
		const row = (lbl, val) => card.append(el("div", { className: "row" }, el("span", {}, lbl), el("b", {}, String(val))))
		row("Номеров", h.rooms)
		row("Мест всего", h.beds)
		row("Занято сегодня", h.occupied)
		row("Свободно", h.free)
		row("Загрузка", `${h.load}%`)
		const track = el("div", { className: "bar-track" })
		track.append(el("div", { className: "bar-fill", style: `width:${h.load}%` }))
		card.append(track)
		grid.append(card)
	})
	body.append(grid)
}

async function renderAudit() {
	const rows = await apiJson("/audit")
	const body = $("#audit-body")
	body.innerHTML = ""
	if (!rows.length) {
		body.append(el("div", { className: "empty-note" }, "Журнал пуст."))
		return
	}
	body.append(
		dataTable(["Дата и время", "Пользователь", "Действие"], rows, (r) =>
			el(
				"tr",
				{},
				el("td", {}, r.created_at),
				el("td", {}, r.username || "—"),
				el("td", {}, r.summary || `${r.method} ${r.path}`),
			),
		),
	)
}

function renderLegend() {
	const lg = $("#legend")
	lg.innerHTML = ""
	S.statuses.forEach((s) =>
		lg.append(
			el("div", { className: "item" }, el("span", { className: "swatch", style: `background:${s.color}` }), s.name),
		),
	)
	lg.append(el("span", { className: "muted", style: "margin-left:auto;font-size:12px" }, "Клик по ячейке — добавить/изменить размещение"))
}

/* ---------- grid ---------- */
async function refreshGrid() {
	const hotel = $("#f-hotel").value
	if (!hotel) {
		$("#grid").innerHTML = '<p class="muted" style="padding:20px">Нет гостиниц. Добавьте первую.</p>'
		return
	}
	const cls = $("#f-class").value
	const from = $("#f-from").value
	const to = $("#f-to").value
	S.rooms = await apiJson(`/rooms?hotel_id=${hotel}${cls ? `&class_id=${cls}` : ""}`)
	const pls = await apiJson(`/placements?from=${from}&to=${to}`)
	S.placements = {}
	for (const p of pls) (S.placements[p.bed_id] ||= []).push(p)
	renderStats()
	drawGrid(from, to)
}

function renderStats() {
	const today = fmt(new Date())
	let beds = 0
	const occupied = new Set()
	for (const room of S.rooms) {
		for (const bed of room.beds) {
			beds++
			const active = (S.placements[bed.id] || []).find((p) => p.date_from <= today && p.date_to >= today)
			if (active) occupied.add(bed.id)
		}
	}
	const load = beds ? Math.round((occupied.size / beds) * 100) : 0
	const data = [
		["Номеров", S.rooms.length],
		["Мест всего", beds],
		["Занято сегодня", occupied.size],
		["Свободно", beds - occupied.size],
		["Загрузка", `${load}%`],
	]
	const wrap = $("#stats")
	wrap.innerHTML = ""
	for (const [label, value] of data) {
		wrap.append(
			el("div", { className: "stat-card" }, el("div", { className: "value", textContent: String(value) }), el("p", { className: "label", textContent: label })),
		)
	}
}

/* перетаскивание по шахматке для создания брони (как в Bnovo) */
let dragState = null
function updateDragHighlight() {
	document.querySelectorAll("td.day.drag-sel").forEach((c) => c.classList.remove("drag-sel"))
	if (!dragState) return
	const [lo, hi] = [dragState.start, dragState.end].sort()
	document.querySelectorAll(`td.day[data-bed="${dragState.bed.id}"]`).forEach((c) => {
		if (c.dataset.date >= lo && c.dataset.date <= hi) c.classList.add("drag-sel")
	})
}
document.addEventListener("mouseup", () => {
	if (!dragState) return
	const ds = dragState
	dragState = null
	updateDragHighlight()
	const [from, to] = [ds.start, ds.end].sort()
	if (from === to) placementModal(ds.bed, ds.existing, from)
	else placementModal(ds.bed, null, from, refreshGrid, to)
})

function drawGrid(from, to) {
	const days = eachDay(from, to)
	const dayStrs = days.map(fmt)
	const table = el("table", { className: "grid" })
	const thead = el("thead")
	const hr = el("tr")
	hr.append(el("th", { className: "cell-label", textContent: "Номер / место" }))
	const todayStr = fmt(new Date())
	days.forEach((d) => {
		const wd = d.getDay() === 0 || d.getDay() === 6
		const cls = fmt(d) === todayStr ? "today" : wd ? "weekend" : ""
		hr.append(
			el("th", { className: cls, innerHTML: `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}<br><span class="muted">${["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][d.getDay()]}</span>` }),
		)
	})
	thead.append(hr)
	table.append(thead)

	const tb = el("tbody")
	if (!S.rooms.length) {
		tb.append(el("tr", {}, el("td", { colSpan: days.length + 1, className: "muted", style: "padding:16px" }, "Нет номеров по фильтру.")))
	}
	for (const room of S.rooms) {
		const head = el("tr", { className: "row-room" })
		const label = el("td", { className: "cell-label" })
		label.append(el("span", {}, `№ ${room.number} · ${room.class_name || "—"} · ${room.capacity} мест`))

		const occ = room.beds.filter((b) => (S.placements[b.id] || []).some((p) => p.date_from <= todayStr && p.date_to >= todayStr)).length
		const occClass = occ === 0 ? "empty" : occ >= room.capacity ? "full" : "part"
		label.append(el("span", { className: `occ-badge ${occClass}`, title: "Занято сегодня" }, `${occ}/${room.capacity}`))

		const btnReport = el("button", { className: "btn btn-transparent btn-sm icon-only", title: "Выгрузить отчёт по номеру" })
		btnReport.append(iconEl("download"))
		btnReport.onclick = () => download(`/report/room/${room.id}`)
		label.append(" ", btnReport)
		if (can("editor")) {
			const edit = el("button", { className: "btn btn-transparent btn-sm icon-only", title: "Изменить номер" })
			edit.append(iconEl("pencil"))
			edit.onclick = () => roomModal(room)
			label.append(" ", edit)
		}
		head.append(label)
		head.append(el("td", { colSpan: days.length }))
		tb.append(head)

		for (const bed of room.beds) {
			const tr = el("tr")
			tr.append(el("td", { className: "cell-label", style: "min-width:160px;padding-left:24px", textContent: bed.label }))
			const list = S.placements[bed.id] || []
			const cells = []
			dayStrs.forEach((ds) => {
				const cell = el("td", { className: ds === todayStr ? "day col-today" : "day" })
				const p = list.find((x) => x.date_from <= ds && x.date_to >= ds)
				if (can("editor")) {
					cell.dataset.bed = bed.id
					cell.dataset.date = ds
					cell.onmousedown = (e) => {
						e.preventDefault()
						dragState = { bed, existing: p, start: ds, end: ds }
						updateDragHighlight()
					}
					cell.onmouseenter = () => {
						if (dragState && String(dragState.bed.id) === String(bed.id)) {
							dragState.end = ds
							updateDragHighlight()
						}
					}
				}
				cells.push(cell)
				tr.append(cell)
			})
			const lastStr = dayStrs[dayStrs.length - 1]
			for (const p of list) {
				if (isFreeStatus(p.status_name)) continue
				if (p.date_to < dayStrs[0] || p.date_from > lastStr) continue
				const s = p.date_from <= dayStrs[0] ? 0 : dayStrs.indexOf(p.date_from)
				const e = p.date_to >= lastStr ? dayStrs.length - 1 : dayStrs.indexOf(p.date_to)
				if (s < 0 || e < 0) continue
				const span = e - s + 1
				const bar = el(
					"div",
					{
						className: "bar",
						style: `background:${p.status_color};width:calc(${span} * var(--day-w) - 6px)`,
						title: `${p.status_name}: ${p.resident_name || "—"} (${p.date_from} – ${p.date_to})`,
					},
					p.resident_name || p.status_name,
				)
				cells[s].appendChild(bar)
			}
			tb.append(tr)
		}
	}
	table.append(tb)
	$("#grid").innerHTML = ""
	$("#grid").append(table)
}

async function download(pathName) {
	const res = await api(pathName)
	const blob = await res.blob()
	const cd = res.headers.get("Content-Disposition") || ""
	const name = (cd.match(/filename="(.+)"/) || [])[1] || "report.xlsx"
	const url = URL.createObjectURL(blob)
	const a = el("a", { href: url, download: name })
	document.body.append(a)
	a.click()
	a.remove()
	URL.revokeObjectURL(url)
}

/* ---------- modal helper ---------- */
function modal(title, bodyNodes, footNodes) {
	const root = $("#modal-root")
	const overlay = el("div", { className: "overlay" })
	overlay.onclick = (e) => {
		if (e.target === overlay) root.innerHTML = ""
	}
	const box = el("div", { className: "modal" }, el("h3", {}, title), el("div", { className: "body" }, ...bodyNodes), el("div", { className: "foot" }, ...footNodes))
	overlay.append(box)
	root.innerHTML = ""
	root.append(overlay)
	return () => (root.innerHTML = "")
}
const field = (labelText, input) => el("div", {}, el("label", {}, labelText), input)

/* ---------- подтверждение ---------- */
function confirmDialog(message, okText = "Удалить") {
	return new Promise((resolve) => {
		const close = modal(
			"Подтверждение",
			[el("p", { style: "margin:0" }, message)],
			[
				el("button", { className: "btn btn-transparent", textContent: "Отмена", onclick: () => { close(); resolve(false) } }),
				Object.assign(el("button", { className: "btn btn-danger-fill", textContent: okText }), { onclick: () => { close(); resolve(true) } }),
			],
		)
	})
}

/* ---------- карточка гостя ---------- */
async function guestCard(id) {
	let data
	try {
		data = await apiJson(`/residents/${id}/card`)
	} catch (e) {
		return toast(e.message)
	}
	const r = data.resident
	const info = el("div", { className: "info-box" })
	const line = (lbl, val) => val && info.append(el("div", {}, `${lbl}: `, el("b", {}, val)))
	line("Таб. №", r.tab_number)
	line("Организация", r.company)
	line("Должность", r.position)
	line("Телефон", r.phone)
	line("Примечание", r.note)
	if (!info.children.length) info.append(el("div", { className: "muted" }, "Доп. данных нет"))

	const history = el("div", {})
	history.append(el("div", { className: "section-title" }, "История проживаний", el("span", { className: "count" }, String(data.stays.length))))
	if (!data.stays.length) {
		history.append(el("div", { className: "empty-note" }, "Размещений нет."))
	} else {
		history.append(
			dataTable(["Гостиница", "Номер", "Место", "Заезд", "Выезд", "Статус"], data.stays, (s) =>
				el("tr", {}, el("td", {}, s.hotel_name), el("td", {}, s.room_number), el("td", {}, s.bed_label), el("td", {}, s.date_from), el("td", {}, s.date_to), statusCell(s.status_name, s.status_color)),
			),
		)
	}

	const close = modal(
		r.full_name,
		[info, history],
		[
			Object.assign(el("button", { className: "btn", textContent: "⭳ Excel" }), { onclick: () => download(`/report/resident/${r.id}`) }),
			Object.assign(el("button", { className: "btn", textContent: "🖨 Печать / PDF" }), {
				onclick: () => {
					const meta = [`Таб. №: ${r.tab_number || "—"}`, `Организация: ${r.company || "—"}`, `Должность: ${r.position || "—"}`, `Телефон: ${r.phone || "—"}`]
					const rows = data.stays.map((s) => [s.hotel_name, s.room_number, s.bed_label, s.date_from, s.date_to, s.status_name])
					openPrint(`Карточка проживающего: ${r.full_name}`, meta, ["Гостиница", "Номер", "Место", "Заезд", "Выезд", "Статус"], rows)
				},
			}),
			el("button", { className: "btn btn-primary", textContent: "Закрыть", onclick: () => close() }),
		],
	)
}

/* ---------- глобальный поиск ---------- */
const gsInput = $("#global-search")
const gsResults = $("#gsearch-results")
gsInput.addEventListener("input", debounce(async () => {
	const q = gsInput.value.trim()
	if (q.length < 2) return gsResults.classList.add("hidden")
	const people = await apiJson(`/residents?q=${encodeURIComponent(q)}`)
	gsResults.innerHTML = ""
	if (!people.length) {
		gsResults.append(el("div", { className: "gs-item muted" }, "Ничего не найдено"))
	} else {
		people.slice(0, 8).forEach((p) => {
			const item = el("div", { className: "gs-item" }, p.full_name, p.company || p.tab_number ? el("small", {}, ` · ${p.company || p.tab_number}`) : "")
			item.onclick = () => {
				gsResults.classList.add("hidden")
				gsInput.value = ""
				guestCard(p.id)
			}
			gsResults.append(item)
		})
	}
	gsResults.classList.remove("hidden")
}, 300))
document.addEventListener("click", (e) => {
	if (!e.target.closest(".gsearch-wrap")) gsResults.classList.add("hidden")
})

/* ---------- placement modal ---------- */
function placementModal(bed, existing, date, onSaved, dateTo) {
	const done = onSaved || refreshGrid
	const resInput = el("input", { placeholder: "Начните вводить ФИО", value: existing?.resident_name || "" })
	let residentId = existing?.resident_id || null
	const suggest = el("div", { className: "list" })
	const infoBox = el("div", { className: "info-box hidden" })
	const showInfo = (p) => {
		if (!p) return infoBox.classList.add("hidden")
		infoBox.classList.remove("hidden")
		infoBox.innerHTML = ""
		const line = (lbl, val) => val && infoBox.append(el("div", {}, `${lbl}: `, el("b", {}, val)))
		line("Таб. №", p.tab_number)
		line("Организация", p.company)
		line("Должность", p.position)
		line("Телефон", p.phone)
		if (!infoBox.children.length) infoBox.append(el("div", { className: "muted" }, "Доп. данных нет"))
	}
	resInput.oninput = async () => {
		residentId = null
		showInfo(null)
		const q = resInput.value.trim()
		if (q.length < 2) return (suggest.innerHTML = "")
		const people = await apiJson(`/residents?q=${encodeURIComponent(q)}`)
		suggest.innerHTML = ""
		people.slice(0, 5).forEach((p) => {
			const item = el("div", { className: "li" }, el("span", { className: "grow" }, `${p.full_name}${p.tab_number ? ` · ${p.tab_number}` : ""}`))
			item.onclick = () => {
				residentId = p.id
				resInput.value = p.full_name
				suggest.innerHTML = ""
				showInfo(p)
			}
			suggest.append(item)
		})
	}
	if (existing?.resident_id) {
		apiJson(`/residents?q=${encodeURIComponent(existing.resident_name || "")}`).then((people) => {
			showInfo(people.find((p) => p.id === existing.resident_id))
		})
	}
	const statusSel = makeSelect(S.statuses.map((s) => ({ value: s.id, label: s.name })), existing?.status_id ?? S.statuses[0]?.id)
	const fromI = makeDatePicker(existing?.date_from || date)
	const toI = makeDatePicker(existing?.date_to || dateTo || date)
	const commentI = el("textarea", { rows: 2, value: existing?.comment || "" })

	const close = modal(
		existing ? "Размещение" : "Новое размещение",
		[
			el("p", { className: "muted", style: "margin:0" }, bed.label),
			field("Проживающий", resInput),
			suggest,
			infoBox,
			el("div", { className: "row2" }, field("Заезд", fromI), field("Выезд", toI)),
			field("Статус", statusSel),
			field("Комментарий", commentI),
		],
		[
			existing && can("editor")
				? Object.assign(el("button", { className: "btn btn-danger", textContent: "Удалить" }), {
						onclick: async () => {
							if (!(await confirmDialog("Удалить это размещение?"))) return
							await api(`/placements/${existing.id}`, { method: "DELETE" })
							close()
							done()
						},
					})
				: el("span"),
			el("button", { className: "btn btn-transparent", textContent: "Отмена", onclick: () => close() }),
			Object.assign(el("button", { className: "btn btn-primary", textContent: "Сохранить" }), {
				onclick: async () => {
					const payload = {
						bed_id: bed.id,
						resident_id: residentId,
						status_id: Number(statusSel.value),
						date_from: fromI.value,
						date_to: toI.value,
						comment: commentI.value,
					}
					try {
						if (existing) await api(`/placements/${existing.id}`, { method: "PUT", body: JSON.stringify(payload) })
						else await api("/placements", { method: "POST", body: JSON.stringify(payload) })
						close()
						done()
					} catch (e) {
						toast(e.message)
					}
				},
			}),
		],
	)
}

/* ---------- hotel / room modals ---------- */
$("#btn-hotels").onclick = async () => {
	S.hotels = await apiJson("/hotels")
	const listWrap = el("div", { className: "list" })
	const render = () => {
		listWrap.innerHTML = ""
		if (!S.hotels.length) listWrap.append(el("p", { className: "muted" }, "Гостиниц пока нет."))
		S.hotels.forEach((h) => {
			const li = el("div", { className: "li" }, el("span", { className: "grow" }, `${h.name}${h.location ? ` · ${h.location}` : ""}`))
			if (can("editor")) {
				const edit = el("button", { className: "btn btn-transparent btn-sm icon-only", title: "Изменить" }, iconEl("pencil"))
				edit.onclick = () => hotelForm(h, refresh)
				li.append(edit)
			}
			if (can("admin")) {
				const del = el("button", { className: "btn btn-danger btn-sm icon-only", title: "Удалить" }, iconEl("x"))
				del.onclick = async () => {
					if (!(await confirmDialog(`Удалить гостиницу «${h.name}» со всеми номерами?`))) return
						await api(`/hotels/${h.id}`, { method: "DELETE" })
					refresh()
				}
				li.append(del)
			}
			listWrap.append(li)
		})
	}
	async function refresh() {
		S.hotels = await apiJson("/hotels")
		render()
		await boot()
	}
	render()
	const close = modal(
		"Гостиницы",
		[listWrap],
		[
			can("editor") ? Object.assign(el("button", { className: "btn", textContent: "+ Добавить гостиницу" }), { onclick: () => hotelForm(null, refresh) }) : el("span"),
			el("button", { className: "btn btn-primary", textContent: "Закрыть", onclick: () => close() }),
		],
	)
}

function hotelForm(hotel, onSaved) {
	const name = el("input", { value: hotel?.name || "" })
	const loc = el("input", { value: hotel?.location || "" })
	const close = modal(
		hotel ? "Изменить гостиницу" : "Новая гостиница",
		[field("Название", name), field("Расположение", loc)],
		[
			el("button", { className: "btn btn-transparent", textContent: "Отмена", onclick: () => close() }),
			Object.assign(el("button", { className: "btn btn-primary", textContent: "Сохранить" }), {
				onclick: async () => {
					const body = JSON.stringify({ name: name.value, location: loc.value })
					try {
						if (hotel) await api(`/hotels/${hotel.id}`, { method: "PUT", body })
						else await api("/hotels", { method: "POST", body })
						close()
						onSaved?.()
					} catch (e) {
						toast(e.message)
					}
				},
			}),
		],
	)
}

/* ---------- классы номеров ---------- */
$("#btn-classes").onclick = async () => {
	S.classes = await apiJson("/classes")
	const listWrap = el("div", { className: "list" })
	const render = () => {
		listWrap.innerHTML = ""
		if (!S.classes.length) listWrap.append(el("p", { className: "muted" }, "Классов пока нет."))
		S.classes.forEach((c) => {
			const li = el("div", { className: "li" }, el("span", { className: "grow" }, c.name))
			if (can("admin")) {
				const del = el("button", { className: "btn btn-danger btn-sm icon-only", title: "Удалить" }, iconEl("x"))
				del.onclick = async () => {
					try {
						if (!(await confirmDialog(`Удалить класс «${c.name}»?`))) return
							await api(`/classes/${c.id}`, { method: "DELETE" })
						S.classes = await apiJson("/classes")
						render()
					} catch (e) {
						toast(e.message)
					}
				}
				li.append(del)
			}
			listWrap.append(li)
		})
	}
	render()
	const name = el("input", { placeholder: "Напр. Двухместный, Люкс" })
	const close = modal(
		"Классы номеров",
		[listWrap, can("editor") ? field("Новый класс", name) : el("span")],
		[
			can("editor")
				? Object.assign(el("button", { className: "btn", textContent: "Добавить" }), {
						onclick: async () => {
							if (!name.value.trim()) return
							try {
								await api("/classes", { method: "POST", body: JSON.stringify({ name: name.value.trim() }) })
								S.classes = await apiJson("/classes")
								render()
								name.value = ""
							} catch (e) {
								toast(e.message)
							}
						},
					})
				: el("span"),
			el("button", { className: "btn btn-primary", textContent: "Готово", onclick: () => { close(); boot() } }),
		],
	)
}

$("#btn-add-room").onclick = () => roomModal(null)
function roomModal(room) {
	const hotelSel = makeSelect(S.hotels.map((h) => ({ value: h.id, label: h.name })), room ? room.hotel_id : $("#f-hotel").value)
	if (room) hotelSel.setDisabled(true)
	const classSel = makeSelect([{ value: "", label: "—" }, ...S.classes.map((c) => ({ value: c.id, label: c.name }))], room?.class_id ?? "")
	const number = el("input", { value: room?.number || "" })
	const floor = el("input", { type: "number", value: room?.floor || "" })
	const capacity = el("input", { type: "number", min: 1, value: room?.capacity || 1 })
	const desc = el("textarea", { rows: 2, value: room?.description || "" })

	const close = modal(
		room ? `Номер № ${room.number}` : "Новый номер",
		[
			field("Гостиница", hotelSel),
			el("div", { className: "row2" }, field("Номер", number), field("Класс", classSel)),
			el("div", { className: "row2" }, field("Этаж", floor), field("Кол-во мест", capacity)),
			field("Доп. информация", desc),
		],
		[
			room && can("editor")
				? Object.assign(el("button", { className: "btn btn-danger", textContent: "Удалить" }), {
						onclick: async () => {
							if (!(await confirmDialog(`Удалить номер № ${room.number} со всеми размещениями?`))) return
							await api(`/rooms/${room.id}`, { method: "DELETE" })
							close()
							refreshGrid()
						},
					})
				: el("span"),
			el("button", { className: "btn btn-transparent", textContent: "Отмена", onclick: close }),
			Object.assign(el("button", { className: "btn btn-primary", textContent: "Сохранить" }), {
				onclick: async () => {
					const payload = {
						hotel_id: Number(hotelSel.value),
						class_id: classSel.value ? Number(classSel.value) : null,
						number: number.value,
						floor: floor.value ? Number(floor.value) : null,
						capacity: Number(capacity.value),
						description: desc.value,
					}
					try {
						if (room) await api(`/rooms/${room.id}`, { method: "PUT", body: JSON.stringify(payload) })
						else await api("/rooms", { method: "POST", body: JSON.stringify(payload) })
						close()
						refreshGrid()
					} catch (e) {
						toast(e.message)
					}
				},
			}),
		],
	)
}

/* ---------- statuses ---------- */
$("#btn-statuses").onclick = async () => {
	S.statuses = await apiJson("/statuses")
	const listWrap = el("div", { className: "list" })
	const render = () => {
		listWrap.innerHTML = ""
		S.statuses.forEach((s) => {
			const sw = el("span", { className: "swatch swatch-lg", style: `background:${s.color}` })
			const li = el("div", { className: "li" }, sw, el("span", { className: "grow" }, s.name))
			if (can("admin")) {
				const del = el("button", { className: "btn btn-danger btn-sm icon-only", title: "Удалить" }, iconEl("x"))
				del.onclick = async () => {
					try {
						if (!(await confirmDialog(`Удалить статус «${s.name}»?`))) return
							await api(`/statuses/${s.id}`, { method: "DELETE" })
						S.statuses = await apiJson("/statuses")
						render()
						renderLegend()
					} catch (e) {
						toast(e.message)
					}
				}
				li.append(del)
			}
			listWrap.append(li)
		})
	}
	render()
	const name = el("input", { placeholder: "Название статуса" })
	const color = makeColorPicker("#1bd96a")
	const close = modal(
		"Статусы номеров",
		[
			listWrap,
			can("editor") ? el("div", {}, field("Новый статус", name), el("div", { style: "margin-top:12px" }, field("Цвет", color))) : el("span"),
		],
		[
			can("editor")
				? Object.assign(el("button", { className: "btn", textContent:"Добавить" }), {
						onclick: async () => {
							if (!name.value) return
							await api("/statuses", { method: "POST", body: JSON.stringify({ name: name.value, color: color.value, sort: S.statuses.length }) })
							S.statuses = await apiJson("/statuses")
							render()
							renderLegend()
							name.value = ""
						},
					})
				: el("span"),
			el("button", { className: "btn btn-primary", textContent: "Готово", onclick: () => { close(); refreshGrid() } }),
		],
	)
}

/* ---------- residents ---------- */
$("#btn-residents").onclick = async () => {
	const search = el("input", { placeholder: "Поиск по ФИО / таб. №" })
	const listWrap = el("div", { className: "list" })
	const load = async () => {
		const people = await apiJson(`/residents?q=${encodeURIComponent(search.value)}`)
		listWrap.innerHTML = ""
		if (!people.length) listWrap.append(el("p", { className: "muted" }, "Никого не найдено."))
		people.forEach((p) => {
			const li = el("div", { className: "li" }, el("span", { className: "grow" }, `${p.full_name}${p.company ? ` · ${p.company}` : ""}${p.tab_number ? ` · ${p.tab_number}` : ""}`))
			const rep = el("button", { className: "btn btn-transparent btn-sm icon-only", title: "Отчёт по проживающему" }, iconEl("download"))
			rep.onclick = () => download(`/report/resident/${p.id}`)
			li.append(rep)
			if (can("editor")) {
				const del = el("button", { className: "btn btn-danger btn-sm icon-only", title: "Удалить" }, iconEl("x"))
				del.onclick = async () => { if (!(await confirmDialog(`Удалить проживающего «${p.full_name}»?`))) return; await api(`/residents/${p.id}`, { method: "DELETE" }); load() }
				li.append(del)
			}
			listWrap.append(li)
		})
	}
	search.oninput = load
	await load()

	const fio = el("input"), tab = el("input"), comp = el("input"), pos = el("input"), phone = el("input")
	const close = modal(
		"Проживающие",
		[
			field("Поиск", search),
			listWrap,
			can("editor")
				? el("div", {}, el("label", {}, "Добавить вручную"),
						el("div", { className: "row2" }, fio, tab),
						el("div", { className: "row2", style: "margin-top:8px" }, comp, pos),
						el("div", { style: "margin-top:8px" }, phone),
					)
				: el("span"),
		],
		[
			can("editor")
				? Object.assign(el("button", { className: "btn", textContent:"Добавить" }), {
						onclick: async () => {
							if (!fio.value) return
							await api("/residents", { method: "POST", body: JSON.stringify({ full_name: fio.value, tab_number: tab.value, company: comp.value, position: pos.value, phone: phone.value }) })
							fio.value = tab.value = comp.value = pos.value = phone.value = ""
							load()
						},
					})
				: el("span"),
			el("button", { className: "btn btn-primary", textContent: "Закрыть", onclick: close }),
		],
	)
	fio.placeholder = "ФИО"; tab.placeholder = "Таб. №"; comp.placeholder = "Организация"; pos.placeholder = "Должность"; phone.placeholder = "Телефон"
}

/* ---------- import ---------- */
$("#btn-import").onclick = () => {
	const file = el("input", { type: "file", accept: ".xlsx,.xls" })
	const close = modal(
		"Импорт проживающих из Excel",
		[
			el("p", { className: "muted", style: "margin:0" }, "Столбцы распознаются по заголовкам: ФИО, Таб. №, Организация, Должность, Телефон, Примечание."),
			field("Файл .xlsx", file),
		],
		[
			el("button", { className: "btn btn-transparent", textContent: "Отмена", onclick: close }),
			Object.assign(el("button", { className: "btn btn-primary", textContent: "Загрузить" }), {
				onclick: async () => {
					if (!file.files[0]) return
					const fd = new FormData()
					fd.append("file", file.files[0])
					try {
						const r = await apiJson("/import/residents", { method: "POST", body: fd })
						toast(`Импортировано: ${r.imported}`)
						close()
					} catch (e) {
						toast(e.message)
					}
				},
			}),
		],
	)
}

/* ---------- users ---------- */
const ROLE_OPTIONS = [
	["viewer", "Просмотр"],
	["editor", "Редактирование"],
	["admin", "Администратор"],
]
const ROLE_DESC = {
	viewer: "Только просмотр шахматки и отчётов",
	editor: "Управление номерами, бронями и проживающими",
	admin: "Полный доступ + управление пользователями",
}

$("#btn-users").onclick = async () => {
	const listWrap = el("div", { className: "list" })
	const load = async () => {
		const users = await apiJson("/users")
		listWrap.innerHTML = ""
		users.forEach((u) => {
			const roleTag = el("span", { className: `tag role-${u.role}`, title: ROLE_DESC[u.role] }, ROLE_OPTIONS.find((r) => r[0] === u.role)?.[1] || u.role)
			const ava = iconEl("circle-user", "li-ava")
			const info = el("div", { className: "grow" }, el("div", { className: "li-title" }, u.full_name || u.username), el("div", { className: "li-sub" }, `@${u.username}`))
			const li = el("div", { className: "li" }, ava, info, roleTag)
			const edit = el("button", { className: "btn btn-transparent btn-sm icon-only", title: "Изменить" }, iconEl("pencil"))
			edit.onclick = () => userForm(u, load)
			li.append(edit)
			if (u.id !== S.user.id) {
				const del = el("button", { className: "btn btn-danger btn-sm icon-only", title: "Удалить" }, iconEl("x"))
				del.onclick = async () => {
					try {
						if (!(await confirmDialog(`Удалить пользователя ${u.username}?`))) return
							await api(`/users/${u.id}`, { method: "DELETE" })
						load()
					} catch (e) {
						toast(e.message)
					}
				}
				li.append(del)
			}
			listWrap.append(li)
		})
	}
	await load()

	const legend = el("div", { className: "info-box" })
	ROLE_OPTIONS.forEach(([v, t]) => legend.append(el("div", {}, el("b", {}, `${t}: `), ROLE_DESC[v])))

	const close = modal(
		"Пользователи",
		[listWrap, legend],
		[
			Object.assign(el("button", { className: "btn", textContent: "+ Добавить пользователя" }), { onclick: () => userForm(null, load) }),
			el("button", { className: "btn btn-primary", textContent: "Закрыть", onclick: () => close() }),
		],
	)
}

function userForm(user, onSaved) {
	const username = el("input", { value: user?.username || "", disabled: !!user })
	const fname = el("input", { value: user?.full_name || "" })
	const pass = el("input", { type: "password", placeholder: user ? "Оставьте пустым — без изменений" : "Пароль" })
	const role = makeSelect(ROLE_OPTIONS.map(([v, t]) => ({ value: v, label: t })), user?.role || "viewer")
	const close = modal(
		user ? `Пользователь: ${user.username}` : "Новый пользователь",
		[
			field("Логин", username),
			field("ФИО", fname),
			field(user ? "Сбросить пароль" : "Пароль", pass),
			field("Роль", role),
		],
		[
			el("button", { className: "btn btn-transparent", textContent: "Отмена", onclick: () => close() }),
			Object.assign(el("button", { className: "btn btn-primary", textContent: "Сохранить" }), {
				onclick: async () => {
					try {
						if (user) {
							await api(`/users/${user.id}`, {
								method: "PUT",
								body: JSON.stringify({ full_name: fname.value, role: role.value, password: pass.value || undefined }),
							})
						} else {
							await api("/users", {
								method: "POST",
								body: JSON.stringify({ username: username.value, password: pass.value, full_name: fname.value, role: role.value }),
							})
						}
						close()
						onSaved?.()
					} catch (e) {
						toast(e.message)
					}
				},
			}),
		],
	)
}

/* ---------- смена своего пароля ---------- */
$("#btn-password").onclick = () => {
	const cur = el("input", { type: "password" })
	const next = el("input", { type: "password" })
	const close = modal(
		"Смена пароля",
		[field("Текущий пароль", cur), field("Новый пароль", next)],
		[
			el("button", { className: "btn btn-transparent", textContent: "Отмена", onclick: () => close() }),
			Object.assign(el("button", { className: "btn btn-primary", textContent: "Сменить" }), {
				onclick: async () => {
					try {
						await api("/me/password", { method: "POST", body: JSON.stringify({ current: cur.value, next: next.value }) })
						toast("Пароль изменён")
						close()
					} catch (e) {
						toast(e.message)
					}
				},
			}),
		],
	)
}

/* ---------- start ---------- */
if (S.token) boot()
