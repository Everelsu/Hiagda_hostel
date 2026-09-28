// Защитные правила раздела «Резервные копии»: удалить можно только введя имя,
// закреплённую и единственную — нельзя, чужие пути не принимаются. База не нужна.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const express = require("express")

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hiagda-bk-"))
process.env.BACKUP_DIR = root
const { router } = require("../server/backups")

function fake(name, { pinned = false } = {}) {
	const dir = path.join(root, name)
	fs.mkdirSync(dir)
	fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ created_at: new Date().toISOString() }))
	if (pinned) fs.writeFileSync(path.join(dir, ".keep"), "")
}

let base, server
test.before(async () => {
	const app = express()
	app.use(express.json())
	app.use((req, _res, next) => ((req.user = { username: "admin" }), next()))
	app.use("/b", router)
	server = app.listen(0)
	base = `http://127.0.0.1:${server.address().port}/b`
})
test.after(() => {
	server.close()
	fs.rmSync(root, { recursive: true, force: true })
})

const del = (name, confirm) =>
	fetch(`${base}/${encodeURIComponent(name)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm }) })

test("удаление: имя, закрепление, единственная копия", async () => {
	fake("2026-01-01_030000")
	assert.equal((await del("2026-01-01_030000", "2026-01-01_030000")).status, 409, "единственную удалять нельзя")

	fake("2026-01-02_030000", { pinned: true })
	fake("2026-01-03_030000")
	assert.equal((await del("2026-01-03_030000", "нет")).status, 400, "без имени — нельзя")
	assert.equal((await del("2026-01-02_030000", "2026-01-02_030000")).status, 409, "закреплённую — нельзя")
	assert.equal((await del("../../etc", "../../etc")).status, 404, "путь вне каталога копий — нет")

	assert.equal((await del("2026-01-03_030000", "2026-01-03_030000")).status, 200)
	assert.ok(!fs.existsSync(path.join(root, "2026-01-03_030000")))

	const list = await (await fetch(base)).json()
	assert.deepEqual(list.items.map((b) => [b.name, b.pinned]), [["2026-01-02_030000", true], ["2026-01-01_030000", false]])
})

test("восстановление без ввода имени не запускается", async () => {
	const r = await fetch(`${base}/2026-01-01_030000/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
	assert.equal(r.status, 400)
})
