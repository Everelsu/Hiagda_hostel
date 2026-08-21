const db = require("./db")
const bcrypt = require("bcryptjs")

const tx = db.transaction(() => {
	if (db.prepare("SELECT COUNT(*) c FROM statuses").get().c === 0) {
		const ins = db.prepare("INSERT INTO statuses (name, color, sort) VALUES (?,?,?)")
		ins.run("Свободно", "#3a3f47", 0)
		ins.run("Забронировано", "#5fc8ff", 1)
		ins.run("Проживает", "#1bd96a", 2)
		ins.run("Ремонт", "#ff8a5c", 3)
		console.log("Созданы базовые статусы")
	}

	if (db.prepare("SELECT COUNT(*) c FROM room_classes").get().c === 0) {
		const ins = db.prepare("INSERT INTO room_classes (name) VALUES (?)")
		for (const n of ["Одноместный", "Двухместный", "Трёхместный"]) ins.run(n)
		console.log("Созданы классы номеров")
	}

	if (db.prepare("SELECT COUNT(*) c FROM amenities").get().c === 0) {
		const ins = db.prepare("INSERT INTO amenities (name, icon, scope) VALUES (?,?,?)")
		const list = [
			["Wi-Fi", "wifi", "both"],
			["Телевизор", "tv", "room"],
			["Душ", "shower", "room"],
			["Холодильник", "fridge", "room"],
			["Кондиционер", "snow", "room"],
			["Столовая", "utensils", "hotel"],
			["Прачечная", "washer", "hotel"],
			["Сушилка для одежды", "wind", "hotel"],
			["Спортзал", "dumbbell", "hotel"],
			["Комната отдыха", "sofa", "hotel"],
		]
		for (const [n, i, s] of list) ins.run(n, i, s)
		console.log("Создан каталог удобств")
	}

	if (db.prepare("SELECT COUNT(*) c FROM hotels").get().c === 0) {
		const hotelId = db
			.prepare(
				"INSERT INTO hotels (name, location, settlement, address, phone, email, check_in, check_out, latitude, longitude, description, rules) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			)
			.run(
				"Вахтовый дом №1",
				"Забайкальский край",
				"п. Вершино-Дарасунский",
				"ул. Рудничная, 4",
				"+7 (3012) 00-00-00",
				"dom1@hiagda.example",
				"14:00",
				"12:00",
				"52.3618",
				"115.5122",
				"Дом компании для вахтового персонала на период работ. Размещение по сменам, питание в столовой на первом этаже.",
				"Тишина после 23:00. Курение только в отведённых местах. Уборка по графику.",
			).lastInsertRowid

		const hotelAmen = db.prepare("SELECT id FROM amenities WHERE scope IN ('hotel','both')").all()
		const haIns = db.prepare("INSERT OR IGNORE INTO hotel_amenities (hotel_id, amenity_id) VALUES (?,?)")
		for (const a of hotelAmen) haIns.run(hotelId, a.id)

		const placeIns = db.prepare("INSERT INTO places (hotel_id, name, kind, note, distance, latitude, longitude) VALUES (?,?,?,?,?,?,?)")
		placeIns.run(hotelId, "Столовая «Смена»", "Питание", "Завтрак 7:00–9:00, обед 13:00–15:00, ужин 19:00–21:00", "1 этаж", "52.3620", "115.5125")
		placeIns.run(hotelId, "Магазин «Продукты»", "Магазин", "Круглосуточно", "200 м", "52.3630", "115.5140")
		placeIns.run(hotelId, "Медпункт", "Медицина", "Дежурный фельдшер", "соседний корпус", "52.3612", "115.5110")

		const infoIns = db.prepare("INSERT INTO hotel_info_sections (hotel_id, kind, title, body, sort) VALUES (?,?,?,?,?)")
		infoIns.run(hotelId, "schedule", "Распорядок дня", "Подъём 6:30\nЗавтрак 7:00–9:00\nВыезд на смену 8:00\nУжин 19:00–21:00\nБаня по чётным дням 18:00–22:00", 0)
		infoIns.run(hotelId, "contacts", "Полезные телефоны", "Комендант: +7 900 000-00-01\nМедпункт: +7 900 000-00-02\nДиспетчер транспорта: +7 900 000-00-03\nОхрана: +7 900 000-00-04", 1)

		const classes = db.prepare("SELECT * FROM room_classes ORDER BY id").all()
		const roomAmen = db.prepare("SELECT id FROM amenities WHERE scope IN ('room','both')").all()
		const room = db.prepare("INSERT INTO rooms (hotel_id, class_id, number, floor, capacity, description) VALUES (?,?,?,?,?,?)")
		const bed = db.prepare("INSERT INTO beds (room_id, label) VALUES (?,?)")
		const raIns = db.prepare("INSERT OR IGNORE INTO room_amenities (room_id, amenity_id) VALUES (?,?)")
		const roomIds = []
		for (let i = 1; i <= 6; i++) {
			const cls = classes[i % classes.length]
			const cap = (i % 3) + 1
			const roomId = room.run(hotelId, cls.id, `00${i}`, 1, cap, "Тёплый номер с тумбочками и шкафом.").lastInsertRowid
			for (let j = 1; j <= cap; j++) bed.run(roomId, `Место ${j}`)
			for (const a of roomAmen) raIns.run(roomId, a.id)
			roomIds.push(roomId)
		}
		console.log("Создана демо-гостиница с номерами и удобствами")

		const proResId = db
			.prepare("INSERT INTO residents (full_name, tab_number, company, position, phone, about) VALUES (?,?,?,?,?,?)")
			.run("Иванов Иван Петрович", "В-101", "ППГХО", "Проходчик", "+7 900 000-00-00", "Работаю на вахте, в свободное время — спортзал и книги.").lastInsertRowid
		const neighborId = db
			.prepare("INSERT INTO residents (full_name, tab_number, company, position, about) VALUES (?,?,?,?,?)")
			.run("Сидоров Пётр Алексеевич", "В-102", "ППГХО", "Электрослесарь", "Вахта 30/30, родом из Читы.").lastInsertRowid

		const proResStatus = db.prepare("SELECT id FROM statuses WHERE name LIKE '%рожива%'").get()
		const beds = db.prepare("SELECT b.id FROM beds b WHERE b.room_id = ? ORDER BY b.id").all(roomIds[1])
		const today = new Date()
		const from = new Date(today); from.setDate(from.getDate() - 5)
		const to = new Date(today); to.setDate(to.getDate() + 25)
		const fmt = (d) => d.toISOString().slice(0, 10)
		const plIns = db.prepare(
			"INSERT INTO placements (bed_id, resident_id, status_id, stage, date_from, date_to) VALUES (?,?,?,?,?,?)",
		)
		plIns.run(beds[0].id, proResId, proResStatus.id, "checked_in", fmt(from), fmt(to))
		if (beds[1]) plIns.run(beds[1].id, neighborId, proResStatus.id, "checked_in", fmt(from), fmt(to))

		db.prepare("INSERT INTO users (username, password_hash, full_name, role, resident_id) VALUES (?,?,?,?,?)").run(
			"vahta",
			bcrypt.hashSync("vahta", 10),
			"Иванов Иван Петрович",
			"viewer",
			proResId,
		)
		console.log("Создан демо-вахтовик: логин vahta / пароль vahta")

		db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,'observer')").run(
			"prosmotr",
			bcrypt.hashSync("prosmotr", 10),
			"Наблюдатель (только просмотр)",
		)
		console.log("Создан сотрудник (Просмотр): логин prosmotr / пароль prosmotr")

		const adminId = db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,'admin')").run(
			"admin",
			bcrypt.hashSync("admin", 10),
			"Администратор",
		).lastInsertRowid
		console.log("Создан администратор: логин admin / пароль admin")

		const annIns = db.prepare("INSERT INTO announcements (hotel_id, title, body, pinned, created_by) VALUES (?,?,?,?,?)")
		annIns.run(null, "Добро пожаловать в NochOtel", "Здесь появляются объявления коменданта: отключения воды, график бани, выезды транспорта.", 1, adminId)
		annIns.run(hotelId, "Плановое отключение горячей воды", "18 числа с 10:00 до 16:00 в доме №1 не будет горячей воды. Приносим извинения.", 0, adminId)

		db.prepare("INSERT INTO reviews (hotel_id, resident_id, rating, text) VALUES (?,?,?,?)").run(
			hotelId, neighborId, 4, "Тепло, чисто, столовая рядом. Wi-Fi иногда пропадает.",
		)
	}
})

tx()
console.log("Готово.")
