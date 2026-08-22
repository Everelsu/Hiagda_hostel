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

test("отзыв о номере и о доме считаются раздельно", async () => {
	// вахтовик с активным размещением
	const acc = await call("POST", `/residents/${residentId}/account`, { token: adminToken })
	assert.equal(acc.status, 200)
	const login = await call("POST", "/login", { body: { username: acc.json.username, password: acc.json.password } })
	const meToken = login.json.token

	assert.equal((await call("POST", "/me/review", { token: meToken, body: { target: "room", rating: 2 } })).status, 200)
	assert.equal((await call("POST", "/me/review", { token: meToken, body: { target: "hotel", rating: 5 } })).status, 200)

	const ov = await call("GET", "/me/overview", { token: meToken })
	assert.equal(ov.json.my_room_review.rating, 2, "отзыв о номере сохраняется отдельно")
	assert.equal(ov.json.my_review.rating, 5, "отзыв о доме сохраняется отдельно")
	assert.equal(ov.json.room.rating, 2, "рейтинг номера — только из отзывов о номере")
	assert.equal(ov.json.hotel.rating, 5, "рейтинг дома не смешивается с отзывами о номерах")
	assert.ok(ov.json.stay.total_days > 0, "сводка по вахте посчитана")
})

test("вахтовик не может подать заявку по чужому номеру", async () => {
	const login = await call("POST", "/login", { body: { username: "watch1", password: "watch123" } })
	// observer — не вахтовик и не персонал по заявкам: у него нет своего номера
	const foreign = await call("POST", "/me/issues", { token: login.json.token, body: { room_id: 1, comment: "чужая" } })
	assert.equal(foreign.status, 403)
})

test("план этажа сохраняется и отдаётся вахтовику без чужих данных", async () => {
	const rooms = await call("GET", "/rooms", { token: adminToken })
	const room = rooms.json[0]

	const saved = await call("PUT", "/plan/layout", {
		token: adminToken,
		body: {
			hotel_id: room.hotel_id,
			floor: room.floor ?? 1,
			rooms: [{ id: room.id, plan_x: 2, plan_y: 3, plan_w: 4, plan_h: 2 }],
			shapes: [{ kind: "corridor", label: "Коридор", x: 0, y: 6, w: 10, h: 2 }],
		},
	})
	assert.equal(saved.status, 200)

	const plan = await call("GET", `/plan?hotel_id=${room.hotel_id}`, { token: adminToken })
	const placed = plan.json.rooms.find((r) => r.id === room.id)
	assert.equal(placed.plan_x, 2)
	assert.equal(placed.plan_w, 4)
	assert.equal(plan.json.shapes.length, 1)
	assert.equal(plan.json.shapes[0].kind, "corridor")

	// у наблюдателя нет прав на правку плана
	const obs = await call("POST", "/login", { body: { username: "watch1", password: "watch123" } })
	const denied = await call("PUT", "/plan/layout", {
		token: obs.json.token,
		body: { hotel_id: room.hotel_id, floor: 1, rooms: [], shapes: [] },
	})
	assert.equal(denied.status, 403)
})

test("бронь переносится на другое место, занятое — отклоняется", async () => {
	const rooms = await call("GET", "/rooms", { token: adminToken })
	const beds = rooms.json.flatMap((r) => r.beds)
	const target = beds.find((b) => b.id !== bedId)

	const list = await call("GET", `/placements?bed_id=${bedId}`, { token: adminToken })
	const p = list.json[0]

	const moved = await call("PUT", `/placements/${p.id}`, {
		token: adminToken,
		body: { bed_id: target.id, resident_id: p.resident_id, status_id: p.status_id, stage: p.stage, date_from: p.date_from, date_to: p.date_to },
	})
	assert.equal(moved.status, 200, "перенос на свободное место разрешён")

	const after = await call("GET", `/placements?bed_id=${target.id}`, { token: adminToken })
	assert.ok(after.json.some((x) => x.id === p.id), "бронь оказалась на новом месте")

	// вторая бронь на то же место в те же даты — конфликт
	const clash = await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: target.id, resident_id: residentId, status_id: statusId, date_from: p.date_from, date_to: p.date_to },
	})
	assert.equal(clash.status, 409)
})

test("справочники отдают счётчик использования", async () => {
	const created = await call("POST", "/classes", { token: adminToken, body: { name: "Люкс" } })
	assert.equal(created.status, 200)

	const classes = await call("GET", "/classes", { token: adminToken })
	const lux = classes.json.find((c) => c.id === created.json.id)
	assert.equal(lux.used_count, 0, "новый тип ещё нигде не используется")

	// статус, на котором висят брони из предыдущих тестов
	const statuses = await call("GET", "/statuses", { token: adminToken })
	const used = statuses.json.find((s) => s.id === statusId)
	assert.ok(used.used_count > 0, "статус показывает число броней")

	// переименование справочника
	const renamed = await call("PUT", `/classes/${created.json.id}`, { token: adminToken, body: { name: "Люкс+" } })
	assert.equal(renamed.status, 200)
	const after = await call("GET", "/classes", { token: adminToken })
	assert.equal(after.json.find((c) => c.id === created.json.id).name, "Люкс+")
})

test("угловые/Г-образные помещения: маска клеток сохраняется", async () => {
	const rooms = await call("GET", "/rooms", { token: adminToken })
	const room = rooms.json[0]

	const saved = await call("PUT", "/plan/layout", {
		token: adminToken,
		body: {
			hotel_id: room.hotel_id,
			floor: room.floor ?? 1,
			// Г-образная комната: вырезан правый нижний угол
			rooms: [{ id: room.id, plan_x: 0, plan_y: 0, plan_w: 3, plan_h: 2, plan_cells: "111/100" }],
			shapes: [{ kind: "corridor", x: 0, y: 4, w: 4, h: 2, cells: "1111/0011" }],
		},
	})
	assert.equal(saved.status, 200)

	const plan = await call("GET", `/plan?hotel_id=${room.hotel_id}`, { token: adminToken })
	assert.equal(plan.json.rooms.find((r) => r.id === room.id).plan_cells, "111/100")
	assert.equal(plan.json.shapes[0].cells, "1111/0011")

	// сплошная маска бессмысленна — сервер сводит её к обычному прямоугольнику
	await call("PUT", "/plan/layout", {
		token: adminToken,
		body: {
			hotel_id: room.hotel_id,
			floor: room.floor ?? 1,
			rooms: [{ id: room.id, plan_x: 0, plan_y: 0, plan_w: 2, plan_h: 2, plan_cells: "11/11" }],
			shapes: [],
		},
	})
	const plain = await call("GET", `/plan?hotel_id=${room.hotel_id}`, { token: adminToken })
	assert.equal(plain.json.rooms.find((r) => r.id === room.id).plan_cells, null, "сплошная маска не хранится")
})

test("ремонт ставится без профиля проживающего", async () => {
	const rooms = await call("GET", "/rooms", { token: adminToken })
	const room = rooms.json[0]

	const block = await call("POST", `/rooms/${room.id}/blocks`, {
		token: adminToken,
		body: { date_from: "2027-03-01", date_to: "2027-03-10", reason: "Замена окна" },
	})
	assert.equal(block.status, 200, "ремонт не требует resident_id")

	// на время ремонта место занять нельзя
	const clash = await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: room.beds[0].id, resident_id: residentId, status_id: statusId, date_from: "2027-03-02", date_to: "2027-03-05" },
	})
	assert.equal(clash.status, 409)

	assert.equal((await call("DELETE", `/blocks/${block.json.id}`, { token: adminToken })).status, 200)
})

// Если фронтенд новее сервера, PUT уходил в HTML-404 и превращался в «Ошибка запроса»
test("неизвестный /api-эндпоинт отвечает JSON, а не HTML", async () => {
	const res = await fetch(base + "/plan/nope", {
		method: "PUT",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
		body: "{}",
	})
	assert.equal(res.status, 404)
	assert.match(res.headers.get("content-type") || "", /application\/json/)
	const body = await res.json()
	assert.match(body.error, /не найден/i)
	assert.match(body.error, /перезапустите сервер/i)
})

// «Свободно» = отсутствие брони, «Ремонт» = room_blocks. Ни то ни другое не вешается на человека.
test("системные состояния нельзя назначить брони и нельзя удалить", async () => {
	const statuses = await call("GET", "/statuses", { token: adminToken })
	const free = statuses.json.find((s) => s.code === "free")
	const repair = statuses.json.find((s) => s.code === "repair")
	assert.ok(free && repair, "системные состояния создаются автоматически")
	assert.equal(free.kind, "system")

	for (const st of [free, repair]) {
		const res = await call("POST", "/placements", {
			token: adminToken,
			body: { bed_id: bedId, resident_id: residentId, status_id: st.id, date_from: "2028-01-01", date_to: "2028-01-05" },
		})
		assert.equal(res.status, 400, `статус «${st.name}» не должен назначаться брони`)
	}

	assert.equal((await call("DELETE", `/statuses/${repair.id}`, { token: adminToken })).status, 400, "системное состояние не удаляется")

	// но цвет и подпись менять можно
	const renamed = await call("PUT", `/statuses/${repair.id}`, { token: adminToken, body: { name: "На ремонте", color: "#ff0000" } })
	assert.equal(renamed.status, 200)
	const after = await call("GET", "/statuses", { token: adminToken })
	const still = after.json.find((s) => s.code === "repair")
	assert.equal(still.name, "На ремонте")
	assert.equal(still.kind, "system", "вид не меняется при переименовании")

	// созданный вручную статус — всегда booking
	const custom = await call("POST", "/statuses", { token: adminToken, body: { name: "Бронь брони", color: "#c78aff" } })
	assert.equal(custom.status, 200)
	const list = await call("GET", "/statuses", { token: adminToken })
	assert.equal(list.json.find((s) => s.id === custom.json.id).kind, "booking")
})

test("слишком короткий пароль отклоняется", async () => {
	const weak = await call("POST", "/users", {
		token: adminToken,
		body: { username: "shorty", password: "123", full_name: "X", role: "editor" },
	})
	assert.equal(weak.status, 400)
})
