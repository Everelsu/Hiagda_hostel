// Кастомные элементы управления в стиле Noctrinth (без нативных попапов ОС).
// Каждый компонент — DOM-элемент со свойством .value (get/set) и событием "change".

const _el = (tag, props = {}, ...kids) => {
	const n = Object.assign(document.createElement(tag), props)
	for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k))
	return n
}

let _openMenu = null
document.addEventListener("click", () => {
	if (_openMenu) {
		_openMenu()
		_openMenu = null
	}
})

/* ---------- выпадающий список ---------- */
function makeSelect(items, value) {
	let data = items.slice()
	let current = value ?? (data[0] && data[0].value)
	const root = _el("div", { className: "sel" })
	const btn = _el("button", { type: "button", className: "sel-btn" })
	const labelSpan = _el("span", { className: "sel-label" })
	const caret = _el("span", { className: "ic sel-caret" })
	caret.innerHTML = iconSvg("chevron-down")
	btn.append(labelSpan, caret)
	const menu = _el("div", { className: "sel-menu hidden" })
	root.append(btn, menu)

	const close = () => menu.classList.add("hidden")
	const render = () => {
		const sel = data.find((i) => String(i.value) === String(current))
		labelSpan.textContent = sel ? sel.label : data[0] ? data[0].label : ""
		menu.innerHTML = ""
		data.forEach((i) => {
			const active = String(i.value) === String(current)
			const opt = _el("div", { className: `sel-opt${active ? " active" : ""}` }, i.label)
			if (active) {
				const chk = _el("span", { className: "ic" })
				chk.innerHTML = iconSvg("check")
				opt.append(chk)
			}
			opt.onclick = () => {
				current = i.value
				render()
				close()
				root.dispatchEvent(new Event("change"))
			}
			menu.append(opt)
		})
	}
	btn.onclick = (e) => {
		e.stopPropagation()
		const wasHidden = menu.classList.contains("hidden")
		if (_openMenu) _openMenu()
		if (wasHidden) {
			menu.classList.remove("hidden")
			_openMenu = close
		} else {
			_openMenu = null
		}
	}
	render()
	Object.defineProperty(root, "value", {
		get: () => current,
		set: (v) => {
			current = v
			render()
		},
	})
	root.setItems = (newItems, keep = true) => {
		data = newItems.slice()
		if (!keep || !data.some((i) => String(i.value) === String(current))) current = data[0] && data[0].value
		render()
	}
	root.setDisabled = (d) => {
		root.classList.toggle("sel-disabled", d)
		btn.disabled = d
	}
	return root
}

/* ---------- выбор даты ---------- */
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
function _fmt(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function makeDatePicker(value) {
	let current = value || _fmt(new Date())
	let view = new Date(`${current}T00:00:00`)
	const root = _el("div", { className: "datepick" })
	const btn = _el("button", { type: "button", className: "dp-btn" })
	const labelSpan = _el("span", {})
	const ico = _el("span", { className: "ic" })
	ico.innerHTML = iconSvg("calendar")
	btn.append(labelSpan, ico)
	const pop = _el("div", { className: "dp-pop hidden" })
	root.append(btn, pop)

	const close = () => pop.classList.add("hidden")
	const showLabel = () => {
		const d = new Date(`${current}T00:00:00`)
		labelSpan.textContent = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`
	}
	const renderCal = () => {
		pop.innerHTML = ""
		const head = _el("div", { className: "dp-head" })
		const prev = _el("button", { type: "button", className: "btn btn-transparent btn-sm icon-only" })
		prev.innerHTML = iconSvg("chevron-left")
		const next = _el("button", { type: "button", className: "btn btn-transparent btn-sm icon-only" })
		next.innerHTML = iconSvg("chevron-right")
		const title = _el("span", { className: "dp-title" }, `${MONTHS[view.getMonth()]} ${view.getFullYear()}`)
		prev.onclick = (e) => {
			e.stopPropagation()
			view = new Date(view.getFullYear(), view.getMonth() - 1, 1)
			renderCal()
		}
		next.onclick = (e) => {
			e.stopPropagation()
			view = new Date(view.getFullYear(), view.getMonth() + 1, 1)
			renderCal()
		}
		head.append(prev, title, next)
		pop.append(head)

		const grid = _el("div", { className: "dp-grid" })
		WEEKDAYS.forEach((w) => grid.append(_el("span", { className: "dp-wd" }, w)))
		const first = new Date(view.getFullYear(), view.getMonth(), 1)
		const offset = (first.getDay() + 6) % 7
		const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
		const todayStr = _fmt(new Date())
		for (let i = 0; i < offset; i++) grid.append(_el("span", {}))
		for (let d = 1; d <= days; d++) {
			const ds = _fmt(new Date(view.getFullYear(), view.getMonth(), d))
			const cls = ["dp-day"]
			if (ds === current) cls.push("sel")
			if (ds === todayStr) cls.push("today")
			const cell = _el("button", { type: "button", className: cls.join(" ") }, String(d))
			cell.onclick = (e) => {
				e.stopPropagation()
				current = ds
				showLabel()
				close()
				_openMenu = null
				root.dispatchEvent(new Event("change"))
			}
			grid.append(cell)
		}
		pop.append(grid)
	}
	btn.onclick = (e) => {
		e.stopPropagation()
		const wasHidden = pop.classList.contains("hidden")
		if (_openMenu) _openMenu()
		if (wasHidden) {
			view = new Date(`${current}T00:00:00`)
			renderCal()
			pop.classList.remove("hidden")
			_openMenu = close
		} else {
			_openMenu = null
		}
	}
	showLabel()
	Object.defineProperty(root, "value", {
		get: () => current,
		set: (v) => {
			current = v || _fmt(new Date())
			showLabel()
		},
	})
	return root
}

/* ---------- выбор цвета ---------- */
const COLOR_PALETTE = [
	"#1bd96a", "#42e686", "#0faa4f", "#4f9cff", "#357ffc", "#1f5ff1",
	"#c78aff", "#ac51fb", "#972eef", "#ffa347", "#fe7e11", "#ef6307",
	"#ff496e", "#ed1148", "#9fa4b3", "#616472", "#3a3f47", "#ffffff",
]
function makeColorPicker(value) {
	let current = value || COLOR_PALETTE[0]
	const root = _el("div", { className: "colorpick" })
	const top = _el("div", { className: "cp-top" })
	const preview = _el("span", { className: "cp-preview" })
	const hex = _el("input", { className: "cp-hex", maxLength: 7, value: current })
	top.append(preview, hex)
	const swatches = _el("div", { className: "cp-swatches" })
	root.append(top, swatches)

	const apply = (silent) => {
		preview.style.background = current
		if (!silent) root.dispatchEvent(new Event("change"))
	}
	COLOR_PALETTE.forEach((c) => {
		const sw = _el("button", { type: "button", className: "cp-sw", title: c })
		sw.style.background = c
		sw.onclick = () => {
			current = c
			hex.value = c
			apply()
		}
		swatches.append(sw)
	})
	hex.oninput = () => {
		const v = hex.value.trim()
		if (/^#[0-9a-fA-F]{6}$/.test(v)) {
			current = v
			apply()
		}
	}
	apply(true)
	Object.defineProperty(root, "value", {
		get: () => current,
		set: (v) => {
			current = v || COLOR_PALETTE[0]
			hex.value = current
			apply(true)
		},
	})
	return root
}
