const db = require("./db")

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

	if (db.prepare("SELECT COUNT(*) c FROM hotels").get().c === 0) {
		const hotelId = db.prepare("INSERT INTO hotels (name, location) VALUES (?,?)").run("Гостиница (цех)", "Бурятия").lastInsertRowid
		const classes = db.prepare("SELECT * FROM room_classes ORDER BY id").all()
		const room = db.prepare("INSERT INTO rooms (hotel_id, class_id, number, floor, capacity) VALUES (?,?,?,?,?)")
		const bed = db.prepare("INSERT INTO beds (room_id, label) VALUES (?,?)")
		for (let i = 1; i <= 6; i++) {
			const cls = classes[i % classes.length]
			const cap = (i % 3) + 1
			const roomId = room.run(hotelId, cls.id, `00${i}`, 1, cap).lastInsertRowid
			for (let j = 1; j <= cap; j++) bed.run(roomId, `Место ${j}`)
		}
		console.log("Создана демо-гостиница с номерами")
	}
})

tx()
console.log("Готово.")
