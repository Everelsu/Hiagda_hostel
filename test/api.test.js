// Интеграционные тесты ключевой логики: пересечение броней и права роли «Просмотр».
// Запуск: npm test
//
// Нужна ОТДЕЛЬНАЯ тестовая база PostgreSQL: перед прогоном её схема удаляется
// целиком, поэтому рабочую базу сюда указывать нельзя. Адрес берётся из
// TEST_DATABASE_URL, иначе — из DATABASE_URL/PG* с подменой имени базы на
// nochotel_test. Завести её один раз:
//     createdb -U postgres -O nochotel nochotel_test
const test = require("node:test")
const assert = require("node:assert/strict")
const { once } = require("node:events")
const { Client } = require("pg")

require("../server/env").loadEnv()

// Тестовая база не должна случайно совпасть с рабочей — отсюда и явная подмена имени.
function testDatabaseUrl() {
	if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL
	if (process.env.DATABASE_URL) {
		const u = new URL(process.env.DATABASE_URL)
		u.pathname = "/nochotel_test"
		return u.toString()
	}
	const user = encodeURIComponent(process.env.PGUSER || "nochotel")
	const pass = encodeURIComponent(process.env.PGPASSWORD || "")
	const host = process.env.PGHOST || "127.0.0.1"
	const port = process.env.PGPORT || "5432"
	return `postgresql://${user}${pass ? `:${pass}` : ""}@${host}:${port}/nochotel_test`
}

let base
let server

test.before(async () => {
	const url = testDatabaseUrl()
	if (/\/nochotel(\?|$)/.test(new URL(url).pathname + (new URL(url).search || ""))) {
		throw new Error("TEST_DATABASE_URL указывает на рабочую базу nochotel — тесты её сотрут. Заведите nochotel_test.")
	}
	process.env.DATABASE_URL = url
	process.env.PORT = "0" // эфемерный порт, чтобы не конфликтовать с рабочим сервером
	process.env.JWT_SECRET = "test-secret"

	// Чистая схема на каждый прогон: тесты начинают с пустой базы (первый из них
	// создаёт администратора, а это возможно только пока пользователей нет).
	const client = new Client({ connectionString: url })
	try {
		await client.connect()
	} catch (e) {
		throw new Error(
			`не удалось подключиться к тестовой базе (${e.message}). ` +
				"Создайте её: createdb -U postgres -O nochotel nochotel_test — или задайте TEST_DATABASE_URL.",
		)
	}
	await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
	await client.end()

	// Сервер подключаем только сейчас: при загрузке модуля он сразу поднимает схему,
	// и сделать это надо уже на очищенной базе.
	const app = require("../server/index.js")
	server = app.server
	await app.ready
	if (!server.listening) await once(server, "listening")
	base = `http://127.0.0.1:${server.address().port}/api`
})

test.after(async () => {
	server?.close()
	// Без закрытия пула процесс тестов остаётся висеть на живых соединениях.
	await require("../server/db").close()
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

test("аналитика за период: ночи считаются только внутри периода", async () => {
	// Брони 01–10 и 10–15 сентября на одном месте; период 05–12 включительно = 8 дней.
	// Ночи внутри периода: 05..09 (5) + 10..12 (3) = 8. Мест в номере 2 → загрузка 50%.
	const r = await call("GET", "/analytics?from=2026-09-05&to=2026-09-12", { token: adminToken })
	assert.equal(r.status, 200)
	assert.equal(r.json.days, 8)
	assert.equal(r.json.totals.bedNights, 8)
	assert.equal(r.json.byHotel[0].bed_nights, 8, "пересечение броней с периодом")
	assert.equal(r.json.totals.avgLoad, 50)
	assert.equal(r.json.totals.arrivals, 1)
	assert.equal(r.json.totals.departures, 1)
	assert.equal(r.json.totals.people, 1)
	assert.equal(r.json.byCompany[0].bed_nights, 8)
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

test("вместимость номера уменьшается вместе с местами", async () => {
	const hotels = await call("GET", "/hotels", { token: adminToken })
	const created = await call("POST", "/rooms", {
		token: adminToken,
		body: { hotel_id: hotels.json[0].id, number: "CAP-1", capacity: 4 },
	})
	const roomId = created.json.id
	const beds = async () => {
		const list = await call("GET", `/rooms?hotel_id=${hotels.json[0].id}`, { token: adminToken })
		return list.json.find((r) => r.id === roomId).beds.length
	}
	assert.equal(await beds(), 4, "при создании появились 4 места")

	assert.equal((await call("PUT", `/rooms/${roomId}`, { token: adminToken, body: { number: "CAP-1", capacity: 2 } })).status, 200)
	assert.equal(await beds(), 2, "лишние места удалены")

	assert.equal((await call("PUT", `/rooms/${roomId}`, { token: adminToken, body: { number: "CAP-1", capacity: 5 } })).status, 200)
	assert.equal(await beds(), 5, "места снова добавились")
})

test("занятое место не даёт уменьшить вместимость", async () => {
	const hotels = await call("GET", "/hotels", { token: adminToken })
	const created = await call("POST", "/rooms", {
		token: adminToken,
		body: { hotel_id: hotels.json[0].id, number: "CAP-2", capacity: 2 },
	})
	const list = await call("GET", `/rooms?hotel_id=${hotels.json[0].id}`, { token: adminToken })
	const room = list.json.find((r) => r.id === created.json.id)
	const lastBed = room.beds[room.beds.length - 1]

	await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: lastBed.id, resident_id: residentId, status_id: statusId, date_from: "2029-03-01", date_to: "2029-03-10" },
	})
	const res = await call("PUT", `/rooms/${created.json.id}`, { token: adminToken, body: { number: "CAP-2", capacity: 1 } })
	assert.equal(res.status, 409, "уменьшение отклонено — на месте есть бронь")
	assert.match(res.json.error, /брони/)
})

test("роль «Ремонтная служба»: заявки и ремонт да, брони нет", async () => {
	const made = await call("POST", "/users", {
		token: adminToken,
		body: { username: "repair1", password: "repair123", full_name: "Ремонтник", role: "maintenance" },
	})
	assert.equal(made.status, 200)
	const login = await call("POST", "/login", { body: { username: "repair1", password: "repair123" } })
	const t = login.json.token

	const hotels = await call("GET", "/hotels", { token: adminToken })
	const rooms = await call("GET", `/rooms?hotel_id=${hotels.json[0].id}`, { token: adminToken })
	const roomId = rooms.json[0].id

	// может: читать и обслуживать ремонт
	assert.equal((await call("GET", "/issues", { token: t })).status, 200)
	assert.equal((await call("GET", "/issues/count", { token: t })).status, 200)
	const block = await call("POST", `/rooms/${roomId}/blocks`, {
		token: t,
		body: { date_from: "2029-05-01", date_to: "2029-05-05", reason: "проверка" },
	})
	assert.equal(block.status, 200, "ремонтник ставит номер на ремонт")
	assert.equal((await call("DELETE", `/blocks/${block.json.id}`, { token: t })).status, 200, "и снимает его")

	// не может: брони, номерной фонд, план, администрирование
	const booking = await call("POST", "/placements", {
		token: t,
		body: { bed_id: bedId, resident_id: residentId, status_id: statusId, date_from: "2029-06-01", date_to: "2029-06-05" },
	})
	assert.equal(booking.status, 403, "бронировать не вправе")
	assert.equal((await call("POST", "/rooms", { token: t, body: { hotel_id: hotels.json[0].id, number: "X" } })).status, 403)
	assert.equal((await call("PUT", "/plan/layout", { token: t, body: { hotel_id: hotels.json[0].id, floor: 1, rooms: [], shapes: [] } })).status, 403)
	assert.equal((await call("GET", "/users", { token: t })).status, 403)
	assert.equal((await call("GET", "/audit", { token: t })).status, 403)
})

test("наблюдатель не трогает заявки и ремонт", async () => {
	const login = await call("POST", "/login", { body: { username: "watch1", password: "watch123" } })
	const t = login.json.token
	const hotels = await call("GET", "/hotels", { token: adminToken })
	const rooms = await call("GET", `/rooms?hotel_id=${hotels.json[0].id}`, { token: adminToken })
	assert.equal((await call("POST", `/rooms/${rooms.json[0].id}/blocks`, { token: t, body: { date_from: "2029-07-01", date_to: "2029-07-02" } })).status, 403)
	assert.equal((await call("PUT", "/issues/1/status", { token: t, body: { status: "Починено" } })).status, 403)
})

test("частичное изменение гостиницы не обнуляет остальные поля", async () => {
	const created = await call("POST", "/hotels", {
		token: adminToken,
		body: { name: "Дом для теста", settlement: "п. Тестовый", phone: "+7 000", check_out: "12:00" },
	})
	const id = created.json.id
	assert.equal((await call("PUT", `/hotels/${id}`, { token: adminToken, body: { phone: "+7 111" } })).status, 200)

	const after = await call("GET", `/hotels/${id}`, { token: adminToken })
	assert.equal(after.json.phone, "+7 111", "переданное поле изменилось")
	assert.equal(after.json.settlement, "п. Тестовый", "непереданное поле сохранилось")
	assert.equal(after.json.check_out, "12:00", "и это тоже")
})

test("неверный статус заявки — понятная ошибка, а не 500", async () => {
	const res = await call("PUT", "/issues/1/status", { token: adminToken, body: { status: "Чинится" } })
	assert.equal(res.status, 400)
	assert.match(res.json.error, /Недопустимый статус/)
})

test("слишком короткий пароль отклоняется", async () => {
	const weak = await call("POST", "/users", {
		token: adminToken,
		body: { username: "shorty", password: "123", full_name: "X", role: "editor" },
	})
	assert.equal(weak.status, 400)
})

test("бронь «на ноль ночей» отклоняется", async () => {
	const res = await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: bedId, resident_id: residentId, status_id: statusId, date_from: "2028-01-05", date_to: "2028-01-05" },
	})
	assert.equal(res.status, 400, "бронь без единой ночи сохранять нельзя")
	assert.match(res.json.error, /минимум одна ночь/i)
})

test("ремонт с дня выезда брони не мешает, а поверх брони — не ставится", async () => {
	const hotel = await call("POST", "/hotels", { token: adminToken, body: { name: "Дом ремонта" } })
	const created = await call("POST", "/rooms", { token: adminToken, body: { hotel_id: hotel.json.id, number: "501", capacity: 1 } })
	const rooms = await call("GET", `/rooms?hotel_id=${hotel.json.id}`, { token: adminToken })
	const room = rooms.json.find((r) => r.id === created.json.id)

	const booking = await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: room.beds[0].id, resident_id: residentId, status_id: statusId, date_from: "2028-05-01", date_to: "2028-05-05" },
	})
	assert.equal(booking.status, 200)

	const over = await call("POST", `/rooms/${room.id}/blocks`, {
		token: adminToken,
		body: { date_from: "2028-05-03", date_to: "2028-05-08" },
	})
	assert.equal(over.status, 409, "ремонт поверх занятых ночей должен отклоняться")

	const after = await call("POST", `/rooms/${room.id}/blocks`, {
		token: adminToken,
		body: { date_from: "2028-05-05", date_to: "2028-05-08" },
	})
	assert.equal(after.status, 200, "ремонт с дня выезда — свободные ночи, конфликта нет")

	const nextGuest = await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: room.beds[0].id, resident_id: residentId, status_id: statusId, date_from: "2028-04-28", date_to: "2028-05-01" },
	})
	assert.equal(nextGuest.status, 200, "бронь, кончающаяся до ремонта, проходит")
})

test("план этажа не считает отменённую бронь занятым местом", async () => {
	const hotel = await call("POST", "/hotels", { token: adminToken, body: { name: "Дом плана" } })
	const created = await call("POST", "/rooms", { token: adminToken, body: { hotel_id: hotel.json.id, number: "601", capacity: 1 } })
	const rooms = await call("GET", `/rooms?hotel_id=${hotel.json.id}`, { token: adminToken })
	const room = rooms.json.find((r) => r.id === created.json.id)

	const booking = await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: room.beds[0].id, resident_id: residentId, status_id: statusId, date_from: "2028-08-01", date_to: "2028-08-10" },
	})
	const plan = await call("GET", `/plan?hotel_id=${hotel.json.id}&date=2028-08-05`, { token: adminToken })
	assert.equal(plan.json.rooms.find((r) => r.id === room.id).occupied, 1)

	await call("PUT", `/placements/${booking.json.id}`, {
		token: adminToken,
		body: { resident_id: residentId, status_id: statusId, stage: "cancelled", date_from: "2028-08-01", date_to: "2028-08-10" },
	})
	const after = await call("GET", `/plan?hotel_id=${hotel.json.id}&date=2028-08-05`, { token: adminToken })
	assert.equal(after.json.rooms.find((r) => r.id === room.id).occupied, 0, "отменённая бронь не занимает место")
})

test("в день выезда место снова свободно для поиска", async () => {
	const hotel = await call("POST", "/hotels", { token: adminToken, body: { name: "Дом пересменки" } })
	const created = await call("POST", "/rooms", { token: adminToken, body: { hotel_id: hotel.json.id, number: "701", capacity: 1 } })
	const rooms = await call("GET", `/rooms?hotel_id=${hotel.json.id}`, { token: adminToken })
	const room = rooms.json.find((r) => r.id === created.json.id)

	await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: room.beds[0].id, resident_id: residentId, status_id: statusId, date_from: "2028-11-01", date_to: "2028-11-10" },
	})

	const busy = await call("GET", `/availability?hotel_id=${hotel.json.id}&from=2028-11-05&to=2028-11-12`, { token: adminToken })
	assert.equal(busy.json.totals.free_beds, 0, "занятые ночи в выдачу не попадают")

	const free = await call("GET", `/availability?hotel_id=${hotel.json.id}&from=2028-11-10&to=2028-11-15`, { token: adminToken })
	assert.equal(free.json.totals.free_beds, 1, "с дня выезда место снова доступно")
})

test("импорт выгрузки: предпросмотр ничего не пишет, повтор не плодит дублей", async () => {
	// Как в файле заказчика: ФИО под заголовком «Табельный номер», имена заглавными
	const ExcelJS = require("exceljs")
	const wb = new ExcelJS.Workbook()
	const ws = wb.addWorksheet("Sheet1")
	ws.addRow(["Таб.№", "Табельный номер", "Шт.должность (полное)", "Подразделение (полное)", "Балансовая единица"])
	ws.addRow(["77000001", "СЕМЁНОВ СЕМЁН СЕМЁНОВИЧ", "Геолог", "Геологический отдел", "АО «Хиагда»"])
	ws.addRow(["77000002", "Орлова Анна Павловна", "Инженер", "Отдел ОТ", "АО «Хиагда»"])
	ws.addRow(["", "Итого: 2", "", "", ""])
	const buf = Buffer.from(await wb.xlsx.writeBuffer())
	const send = async (dry) => {
		const fd = new FormData()
		fd.append("file", new Blob([buf]), "v.xlsx")
		const r = await fetch(`${base}/import/residents${dry ? "?dry=1" : ""}`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: fd })
		return r.json()
	}
	const count = async () => (await call("GET", "/residents", { token: adminToken })).json.length

	const before = await count()
	const dry = await send(true)
	assert.equal(dry.imported, 2)
	assert.equal(dry.skipped, 1, "строка итогов пропускается")
	assert.equal(await count(), before, "предпросмотр не пишет в базу")

	const real = await send(false)
	assert.equal(real.imported, 2)
	const list = (await call("GET", "/residents", { token: adminToken })).json
	assert.ok(list.some((r) => r.full_name === "Семёнов Семён Семёнович" && r.tab_number === "77000001" && r.department === "Геологический отдел"))

	const again = await send(true)
	assert.equal(again.imported, 0, "повторная выгрузка не создаёт дублей")
	assert.equal(again.same, 2)
})

test("статус следует за стадией: «Заселить» перекрашивает бронь, своя метка сохраняется", async () => {
	const mk = async (name, stage) => (await call("POST", "/statuses", { token: adminToken, body: { name, color: "#123456", stage } })).json.id
	const booked = await mk("Бронь (тест)", "expected")
	const living = await mk("Заселён (тест)", "checked_in")
	const special = await mk("Командировка (тест)", null)

	// Статус не передан — берётся привязанный к стадии
	const p = await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: bedId, resident_id: residentId, date_from: "2029-01-01", date_to: "2029-01-05" },
	})
	assert.equal(p.status, 200)
	const statusOf = async (id) => (await call("GET", "/placements", { token: adminToken })).json.find((x) => x.id === id)?.status_id
	assert.equal(await statusOf(p.json.id), booked)

	await call("POST", `/placements/${p.json.id}/stage`, { token: adminToken, body: { stage: "checked_in" } })
	assert.equal(await statusOf(p.json.id), living, "заселение меняет и цвет")

	// Особая метка не затирается сменой стадии
	const q = await call("POST", "/placements", {
		token: adminToken,
		body: { bed_id: bedId, resident_id: residentId, status_id: special, date_from: "2029-02-01", date_to: "2029-02-05" },
	})
	await call("POST", `/placements/${q.json.id}/stage`, { token: adminToken, body: { stage: "checked_in" } })
	assert.equal(await statusOf(q.json.id), special)
})

test("фото плана этажа: ставится, отдаётся в /plan и убирается", async () => {
	const hotels = (await call("GET", "/hotels", { token: adminToken })).json
	const h = hotels[0].id
	const set = await call("PUT", "/plan/image", { token: adminToken, body: { hotel_id: h, floor: 3, url: "/uploads/plan-test.png" } })
	assert.equal(set.status, 200)
	// Повторная установка заменяет, а не дублирует
	await call("PUT", "/plan/image", { token: adminToken, body: { hotel_id: h, floor: 3, url: "/uploads/plan-test2.png" } })
	assert.equal((await call("GET", `/plan?hotel_id=${h}`, { token: adminToken })).json.images[3], "/uploads/plan-test2.png")
	assert.equal((await call("PUT", "/plan/image", { token: adminToken, body: { hotel_id: h, floor: 3, url: "http://evil/x.png" } })).status, 400)
	await call("PUT", "/plan/image", { token: adminToken, body: { hotel_id: h, floor: 3, url: null } })
	assert.equal((await call("GET", `/plan?hotel_id=${h}`, { token: adminToken })).json.images[3], undefined)
})

test("заявка общая на номер: сосед видит открытую и пишет в неё, чужие — нет", async () => {
	const hotels = await call("GET", "/hotels", { token: adminToken })
	const room = await call("POST", "/rooms", { token: adminToken, body: { hotel_id: hotels.json[0].id, number: "202", capacity: 2 } })
	const beds = (await call("GET", `/rooms?hotel_id=${hotels.json[0].id}`, { token: adminToken })).json.find((r) => r.id === room.json.id).beds
	const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
	const tokens = []
	for (const [i, name] of ["Петров Пётр Петрович", "Сидоров Сидор Сидорович"].entries()) {
		const r = await call("POST", "/residents", { token: adminToken, body: { full_name: name } })
		await call("POST", "/placements", { token: adminToken, body: { bed_id: beds[i].id, resident_id: r.json.id, status_id: statusId, date_from: day(-2), date_to: day(10) } })
		const acc = await call("POST", `/residents/${r.json.id}/account`, { token: adminToken })
		tokens.push((await call("POST", "/login", { body: { username: acc.json.username, password: acc.json.password } })).json.token)
	}
	const [a, b] = tokens
	const created = await call("POST", "/me/issues", { token: a, body: { room_id: room.json.id, amenity_name: "Душ", comment: "нет горячей воды" } })
	assert.equal(created.status, 200)

	const seen = (await call("GET", "/me/issues", { token: b })).json.find((i) => i.id === created.json.id)
	assert.ok(seen, "сосед видит заявку по своему номеру")
	assert.equal(seen.mine, false)
	assert.equal(seen.author, "Петров Пётр Петрович")
	assert.equal((await call("POST", `/issues/${created.json.id}/comments`, { token: b, body: { text: "у меня тоже" } })).status, 200)

	// Иванов живёт в другом номере — ни видеть, ни писать
	const other = await call("POST", `/residents/${residentId}/account`, { token: adminToken })
	const ivan = (await call("POST", "/login", { body: { username: other.json.username, password: other.json.password } })).json.token
	assert.equal((await call("POST", `/issues/${created.json.id}/comments`, { token: ivan, body: { text: "эй" } })).status, 403)

	// Починенная соседская заявка у соседа пропадает, у автора — остаётся в истории
	await call("PUT", `/issues/${created.json.id}/status`, { token: adminToken, body: { status: "Починено" } })
	assert.ok(!(await call("GET", "/me/issues", { token: b })).json.some((i) => i.id === created.json.id))
	assert.ok((await call("GET", "/me/issues", { token: a })).json.some((i) => i.id === created.json.id))

	const stays = await call("GET", "/me/stays", { token: a })
	assert.equal(stays.json.length, 1)
	assert.equal(stays.json[0].room_number, "202")
})

test("отзывы видны следующим жильцам без имени; админ удаляет; фото профиля снимается", async () => {
	const hotels = await call("GET", "/hotels", { token: adminToken })
	const room = await call("POST", "/rooms", { token: adminToken, body: { hotel_id: hotels.json[0].id, number: "303", capacity: 2 } })
	const beds = (await call("GET", `/rooms?hotel_id=${hotels.json[0].id}`, { token: adminToken })).json.find((r) => r.id === room.json.id).beds
	const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
	const people = []
	for (const [i, name] of ["Кузнецов Кузьма Кузьмич", "Орлов Олег Олегович"].entries()) {
		const r = await call("POST", "/residents", { token: adminToken, body: { full_name: name } })
		await call("POST", "/placements", { token: adminToken, body: { bed_id: beds[i].id, resident_id: r.json.id, status_id: statusId, date_from: day(-1), date_to: day(5) } })
		const acc = await call("POST", `/residents/${r.json.id}/account`, { token: adminToken })
		people.push({ id: r.json.id, token: (await call("POST", "/login", { body: { username: acc.json.username, password: acc.json.password } })).json.token })
	}
	const [a, b] = people
	await call("POST", "/me/review", { token: a.token, body: { target: "room", rating: 1, text: "дует из окна" } })

	const seen = (await call("GET", "/me/overview", { token: b.token })).json.reviews
	const r = seen.find((x) => x.text === "дует из окна")
	assert.ok(r, "сосед видит чужой отзыв о номере")
	assert.equal(r.target, "room")
	assert.ok(!("resident_name" in r) && !("resident_id" in r), "отзыв без имени автора")
	assert.ok(!(await call("GET", "/me/overview", { token: a.token })).json.reviews.some((x) => x.id === r.id), "свой отзыв не дублируется в чужих")

	assert.equal((await call("DELETE", `/reviews/${r.id}`, { token: adminToken })).status, 200)
	assert.ok(!(await call("GET", "/me/overview", { token: b.token })).json.reviews.some((x) => x.id === r.id))

	await call("PUT", "/me/profile", { token: a.token, body: { photo: "/uploads/x.jpg" } })
	assert.equal((await call("DELETE", `/residents/${a.id}/photo`, { token: a.token })).status, 403, "вахтовик не снимает фото через админский метод")
	assert.equal((await call("DELETE", `/residents/${a.id}/photo`, { token: adminToken })).status, 200)
	assert.equal((await call("GET", "/me/overview", { token: a.token })).json.resident.photo, null)
})
