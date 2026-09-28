// Печать реквизитов доступа: лист A4, карточки 3×N с линиями отреза.
// Печатаем через скрытый iframe — без новой вкладки и блокировщика всплывающих окон.
// @page { margin: 0 } убирает колонтитулы браузера (URL, дата, «1 of 1»).

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

// Компактно: 3 колонки, ~24 карточки на лист. Режутся по пунктиру.
const CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #16161d; padding: 8mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 3mm; font-size: 8pt; color: #777; }
.head b { color: #16161d; font-size: 10pt; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px dashed #bbb; border-left: 1px dashed #bbb; }
.card { border-right: 1px dashed #bbb; border-bottom: 1px dashed #bbb; padding: 3mm 3.5mm 2.5mm; break-inside: avoid; }
.top { display: flex; align-items: center; gap: 4px; font-size: 6.5pt; color: #888; text-transform: uppercase; letter-spacing: .05em; }
.top i { width: 6px; height: 6px; border-radius: 50%; background: #9a5cf5; display: inline-block; }
.top b { color: #16161d; }
.name { font-size: 9pt; font-weight: 700; margin: 1.5mm 0 1.5mm; line-height: 1.2; min-height: 2.4em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cred { display: grid; grid-template-columns: auto 1fr; gap: 1mm 2mm; align-items: center; margin: 0; }
.cred dt { font-size: 6.5pt; color: #777; text-transform: uppercase; }
.cred dd { margin: 0; font-family: "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace; font-size: 10pt; font-weight: 700; letter-spacing: .04em; background: #f3effb; border-radius: 3px; padding: .6mm 2mm; overflow-wrap: anywhere; }
.url { margin-top: 1.5mm; font-size: 6.5pt; color: #555; }
.url b { color: #16161d; }
`

export function printCreds(list, { title = "Доступ в личный кабинет" } = {}) {
	const url = `${location.origin}/login`
	const issued = new Date().toLocaleDateString("ru-RU")
	const cards = list
		.map(
			(c) => `<section class="card">
	<div class="top"><i></i><b>Хиагда</b> · кабинет вахтовика</div>
	<div class="name">${esc(c.full_name)}</div>
	<dl class="cred"><dt>Логин</dt><dd>${esc(c.username)}</dd><dt>Пароль</dt><dd>${esc(c.password)}</dd></dl>
	<div class="url">Вход: <b>${esc(url)}</b> · при входе смените пароль</div>
</section>`,
		)
		.join("")

	const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="head"><b>${esc(title)}</b><span>Выдано ${issued} · ${list.length} шт.</span></div><div class="grid">${cards}</div></body></html>`

	const frame = document.createElement("iframe")
	frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0"
	document.body.appendChild(frame)
	const doc = frame.contentDocument
	doc.open()
	doc.write(html)
	doc.close()
	// Ждём шрифты, иначе первая печать иногда уходит без стилей
	const go = () => {
		frame.contentWindow.focus()
		frame.contentWindow.print()
		setTimeout(() => frame.remove(), 1000)
	}
	;(doc.fonts?.ready || Promise.resolve()).then(() => setTimeout(go, 50))
}
