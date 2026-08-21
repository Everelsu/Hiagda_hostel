// Интеграционные тесты ключевой логики: пересечение броней и права роли «Просмотр».
// Запуск: npm test  (изолированная временная БД через NOCHOTEL_DB, эфемерный порт).
const test = require("node:test")
const assert = require("node:assert/strict")
const { once } = require("node:events")
const os = require("node:os")
const path = require("node:path")
const fs = require("node:fs")

const dbFile = path.join(os.tmpdir(), `nochotel-test-${process.pid}-${Date.now()}.db`)
process.env.NOCHOTEL_DB = dbFile
process.env.PORT = "0" // эфемерный порт, чтобы не конфликтовать с рабочим сервером
process.env.JWT_SECRET = "test-secret"

const { server } = require("../server/index.js")

let base
test.before(async () => {
	if (!server.listening) await once(server, "listening")
	base = `http://127.0.0.1:${server.address().port}/api`
})

test.after(() => {
	server.close()
	for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
		try { fs.unlinkSync(f) } catch {}
	}
})

async function call(method, url, { token, body } = {}) {
	const res = await fetch(base + url, {
		method,
		headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	})
	let json = null
	try { json = await res.json() } catch {}
	return { status: res.status, json }
}

let adminToken, bedId, statusId, residentId

test("создание администратора и базовых данных", async () => {
	const admin = await call("POST", "/register-admin", { body: { username: "boss", password: "boss123" } })
	assert.equal(admin.status, 200)
	adminToken = admin.json.token
	assert.ok(adminToken)

	const hotel = await call("POST", "/hotels", { token: adminToken, body: { name: "Дом №1" } })
	assert.equal(hotel.status, 200)

	const room = await call("POST", "/rooms", { token: adminToken, body: { hotel_id: hotel.json.id, number: "101", capacity: 2 } })
	assert.equal(room.status, 200)

	const rooms = await call("GET", `/rooms?hotel_id=${hotel.json.id}`, { token: adminToken })
	bedId = rooms.json[0].beds[0].id
	assert.ok(bedId, "у номера должно быть создано спальное место")

	const status = await call("POST", "/statuses", { token: adminToken, body: { name: "Проживает", color: "#1bd96a" } })
	assert.equal(status.status, 200)
	statusId = status.json.id

	const resident = await call("POST", "/residents", { token: adminToken, body: { full_name: "Иванов Иван Иванович" } })
	residentId = resident.json.id
})

test("бронь создаётся, пересекающаяся — отклоняется (409)", async () => {
	const first = await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: bedId, resident_id: residentId, status_id: statusId, date_from: "2026-09-01", date_to: "2026-09-10" },
	})
	assert.equal(first.status, 200)

	const overlap = await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: bedId, resident_id: residentId, status_id: statusId, date_from: "2026-09-05", date_to: "2026-09-12" },
	})
	assert.equal(overlap.status, 409, "пересечение по датам должно давать конфликт")
})

test("пересменка: заезд в день выезда предыдущего — разрешён", async () => {
	const back2back = await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: bedId, resident_id: residentId, status_id: statusId, date_from: "2026-09-10", date_to: "2026-09-15" },
	})
	assert.equal(back2back.status, 200, "день выезда должен освобождать место для нового заезда")
})

test("роль «Просмотр» читает данные, но не может редактировать", async () => {
	const created = await call("POST", "/users", {
		token: adminToken,
		body: { username: "watch1", password: "watch123", full_name: "Наблюдатель", role: "observer" },
	})
	assert.equal(created.status, 200)

	const login = await call("POST", "/login", { body: { username: "watch1", password: "watch123" } })
	const obsToken = login.json.token

	const read = await call("GET", "/hotels", { token: obsToken })
	assert.equal(read.status, 200, "наблюдатель должен видеть данные")

	const write = await call("POST", "/hotels", { token: obsToken, body: { name: "Левый дом" } })
	assert.equal(write.status, 403, "наблюдатель не должен создавать записи")
})

test("слишком короткий пароль отклоняется", async () => {
	const weak = await call("POST", "/users", {
		token: adminToken,
		body: { username: "shorty", password: "123", full_name: "X", role: "editor" },
	})
	assert.equal(weak.status, 400)
})
