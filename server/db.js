const path = require("node:path")
const fs = require("node:fs")
const Database = require("better-sqlite3")

// Путь к БД можно переопределить через NOCHOTEL_DB (деплой / изолированные тесты).
const dbPath = process.env.NOCHOTEL_DB || path.join(__dirname, "..", "data", "nochotel.db")
const dataDir = path.dirname(dbPath)
fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")

db.exec(`
	CREATE TABLE IF NOT EXISTS users (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		username      TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		full_name     TEXT,
		role          TEXT NOT NULL CHECK (role IN ('admin','editor','observer','viewer','resident')),
		resident_id   INTEGER REFERENCES residents(id) ON DELETE SET NULL,
		created_at    TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS hotels (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		name        TEXT NOT NULL,
		location    TEXT,
		settlement  TEXT,
		address     TEXT,
		phone       TEXT,
		description TEXT,
		rules       TEXT
	);

	CREATE TABLE IF NOT EXISTS room_classes (
		id   INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE
	);

	CREATE TABLE IF NOT EXISTS statuses (
		id       INTEGER PRIMARY KEY AUTOINCREMENT,
		name     TEXT NOT NULL UNIQUE,
		color    TEXT NOT NULL,
		sort     INTEGER NOT NULL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS rooms (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		hotel_id    INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
		class_id    INTEGER REFERENCES room_classes(id) ON DELETE SET NULL,
		number      TEXT NOT NULL,
		floor       INTEGER,
		capacity    INTEGER NOT NULL DEFAULT 1,
		description TEXT
	);

	CREATE TABLE IF NOT EXISTS beds (
		id      INTEGER PRIMARY KEY AUTOINCREMENT,
		room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
		label   TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS residents (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		full_name  TEXT NOT NULL,
		tab_number TEXT,
		company    TEXT,
		position   TEXT,
		phone      TEXT,
		note       TEXT,
		about      TEXT,
		photo      TEXT
	);

	CREATE TABLE IF NOT EXISTS placements (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		bed_id      INTEGER NOT NULL REFERENCES beds(id) ON DELETE CASCADE,
		resident_id INTEGER REFERENCES residents(id) ON DELETE SET NULL,
		status_id   INTEGER NOT NULL REFERENCES statuses(id) ON DELETE RESTRICT,
		stage       TEXT NOT NULL DEFAULT 'expected'
			CHECK (stage IN ('expected','checked_in','checked_out','cancelled')),
		date_from   TEXT NOT NULL,
		date_to     TEXT NOT NULL,
		comment     TEXT,
		created_at  TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS amenities (
		id    INTEGER PRIMARY KEY AUTOINCREMENT,
		name  TEXT NOT NULL UNIQUE,
		icon  TEXT NOT NULL DEFAULT 'dot',
		scope TEXT NOT NULL DEFAULT 'both' CHECK (scope IN ('room','hotel','both'))
	);

	CREATE TABLE IF NOT EXISTS room_amenities (
		room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
		amenity_id INTEGER NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
		PRIMARY KEY (room_id, amenity_id)
	);

	CREATE TABLE IF NOT EXISTS hotel_amenities (
		hotel_id   INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
		amenity_id INTEGER NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
		PRIMARY KEY (hotel_id, amenity_id)
	);

	CREATE TABLE IF NOT EXISTS places (
		id       INTEGER PRIMARY KEY AUTOINCREMENT,
		hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
		name     TEXT NOT NULL,
		kind     TEXT,
		note     TEXT,
		distance TEXT
	);

	CREATE TABLE IF NOT EXISTS images (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		owner_type TEXT NOT NULL CHECK (owner_type IN ('hotel','room')),
		owner_id   INTEGER NOT NULL,
		url        TEXT NOT NULL,
		sort       INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS reviews (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		hotel_id    INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
		resident_id INTEGER REFERENCES residents(id) ON DELETE SET NULL,
		rating      INTEGER NOT NULL,
		text        TEXT,
		created_at  TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS room_blocks (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
		date_from  TEXT NOT NULL,
		date_to    TEXT NOT NULL,
		reason     TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS room_issues (
		id           INTEGER PRIMARY KEY AUTOINCREMENT,
		room_id      INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
		user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
		amenity_name TEXT NOT NULL,
		comment      TEXT NOT NULL,
		status       TEXT NOT NULL DEFAULT 'Новая' 
			CHECK (status IN ('Новая', 'В работе', 'Починено')),
		created_at   TEXT NOT NULL DEFAULT (datetime('now'))
	);

	-- Геометрия плана этажа: всё, что не номер (коридоры, лестницы, санузлы, выходы).
	-- Координаты — в клетках сетки плана, целые числа.
	CREATE TABLE IF NOT EXISTS plan_shapes (
		id       INTEGER PRIMARY KEY AUTOINCREMENT,
		hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
		floor    INTEGER NOT NULL DEFAULT 1,
		kind     TEXT NOT NULL DEFAULT 'other',
		label    TEXT,
		x        INTEGER NOT NULL DEFAULT 0,
		y        INTEGER NOT NULL DEFAULT 0,
		w        INTEGER NOT NULL DEFAULT 2,
		h        INTEGER NOT NULL DEFAULT 2
	);

	CREATE TABLE IF NOT EXISTS audit_log (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id    INTEGER,
		username   TEXT,
		method     TEXT NOT NULL,
		path       TEXT NOT NULL,
		summary    TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS announcements (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		hotel_id   INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
		title      TEXT NOT NULL,
		body       TEXT NOT NULL,
		pinned     INTEGER NOT NULL DEFAULT 0,
		created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS issue_comments (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		issue_id   INTEGER NOT NULL REFERENCES room_issues(id) ON DELETE CASCADE,
		user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
		text       TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS hotel_info_sections (
		id       INTEGER PRIMARY KEY AUTOINCREMENT,
		hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
		kind     TEXT NOT NULL DEFAULT 'custom',
		title    TEXT NOT NULL,
		body     TEXT NOT NULL,
		sort     INTEGER NOT NULL DEFAULT 0
	);

	CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
	CREATE INDEX IF NOT EXISTS idx_announcements_hotel ON announcements(hotel_id, created_at);
	CREATE INDEX IF NOT EXISTS idx_issue_comments_issue ON issue_comments(issue_id);
	CREATE INDEX IF NOT EXISTS idx_hotel_info_hotel ON hotel_info_sections(hotel_id, sort);
	CREATE INDEX IF NOT EXISTS idx_placements_resident ON placements(resident_id);
	CREATE INDEX IF NOT EXISTS idx_rooms_hotel ON rooms(hotel_id);
	CREATE INDEX IF NOT EXISTS idx_beds_room ON beds(room_id);
	CREATE INDEX IF NOT EXISTS idx_placements_bed ON placements(bed_id);
	CREATE INDEX IF NOT EXISTS idx_placements_dates ON placements(date_from, date_to);
	CREATE INDEX IF NOT EXISTS idx_placements_stage ON placements(stage);
	CREATE INDEX IF NOT EXISTS idx_room_blocks_room ON room_blocks(room_id);
	CREATE INDEX IF NOT EXISTS idx_room_blocks_dates ON room_blocks(date_from, date_to);
	CREATE INDEX IF NOT EXISTS idx_images_owner ON images(owner_type, owner_id);
	CREATE INDEX IF NOT EXISTS idx_reviews_hotel ON reviews(hotel_id);
	CREATE INDEX IF NOT EXISTS idx_reviews_resident ON reviews(resident_id);
	CREATE INDEX IF NOT EXISTS idx_room_issues_lookup ON room_issues(room_id, status);
	CREATE INDEX IF NOT EXISTS idx_plan_shapes_floor ON plan_shapes(hotel_id, floor);
`);


const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all()
const hasColumn = (table, name) => columns(table).some((c) => c.name === name)
const addColumn = (table, name, def) => {
	if (!hasColumn(table, name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`)
}

if (!hasColumn("placements", "stage")) {
	addColumn("placements", "stage", "TEXT NOT NULL DEFAULT 'expected'")
	db.prepare(
		`UPDATE placements SET stage = 'checked_in'
		 WHERE status_id IN (SELECT id FROM statuses WHERE name LIKE '%рожива%')`,
	).run()
}

addColumn("hotels", "settlement", "TEXT")
addColumn("hotels", "address", "TEXT")
addColumn("hotels", "phone", "TEXT")
addColumn("hotels", "description", "TEXT")
addColumn("hotels", "rules", "TEXT")
addColumn("hotels", "email", "TEXT")
addColumn("hotels", "check_in", "TEXT")
addColumn("hotels", "check_out", "TEXT")
addColumn("hotels", "latitude", "TEXT")
addColumn("hotels", "longitude", "TEXT")
addColumn("residents", "about", "TEXT")
addColumn("residents", "photo", "TEXT")
addColumn("residents", "show_contacts", "INTEGER NOT NULL DEFAULT 0")
addColumn("reviews", "reply", "TEXT")
addColumn("reviews", "reply_at", "TEXT")
// room_id = NULL → отзыв о доме, иначе — отзыв о конкретном номере.
addColumn("reviews", "room_id", "INTEGER REFERENCES rooms(id) ON DELETE CASCADE")
addColumn("users", "announcements_seen_at", "TEXT")
addColumn("room_issues", "photo", "TEXT")
addColumn("places", "latitude", "TEXT")
addColumn("places", "longitude", "TEXT")
addColumn("places", "icon", "TEXT")
// Положение номера на плане этажа (клетки сетки). NULL = ещё не размещён на плане.
addColumn("rooms", "plan_x", "INTEGER")
addColumn("rooms", "plan_y", "INTEGER")
addColumn("rooms", "plan_w", "INTEGER")
addColumn("rooms", "plan_h", "INTEGER")
// Маска занятых клеток внутри габарита: строки из 0/1 через "/" ("111/100" — угловая комната).
// NULL = обычный прямоугольник.
addColumn("rooms", "plan_cells", "TEXT")
addColumn("plan_shapes", "cells", "TEXT")

// Статусы бывают двух видов:
//  booking — назначаются брони вручную (Забронировано, Проживает, свои);
//  system  — не назначаются никому, это только цвет для производных состояний:
//            free   — место свободно (брони просто нет),
//            repair — номер на ремонте (это room_blocks, а не бронь).
addColumn("statuses", "kind", "TEXT NOT NULL DEFAULT 'booking'")
addColumn("statuses", "code", "TEXT")

db.prepare("UPDATE statuses SET kind = 'system', code = 'free' WHERE code IS NULL AND name LIKE '%вободн%'").run()
db.prepare("UPDATE statuses SET kind = 'system', code = 'repair' WHERE code IS NULL AND name LIKE '%емонт%'").run()

// Системные состояния должны существовать всегда — иначе нечем красить план и шахматку
for (const [code, name, color, sort] of [
	["free", "Свободно", "#3a3f47", 90],
	["repair", "Ремонт", "#ff8a5c", 91],
]) {
	if (!db.prepare("SELECT id FROM statuses WHERE code = ?").get(code)) {
		db.prepare("INSERT INTO statuses (name, color, sort, kind, code) VALUES (?,?,?,'system',?)").run(name, color, sort, code)
	}
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_statuses_code ON statuses(code) WHERE code IS NOT NULL")

// Брони, висящие на системных статусах, переводим на обычный «Проживает»/«Забронировано»
const bookingFallback = db
	.prepare("SELECT id FROM statuses WHERE kind = 'booking' ORDER BY sort, id LIMIT 1")
	.get()
if (bookingFallback) {
	db.prepare(
		`UPDATE placements SET status_id = ?
		 WHERE status_id IN (SELECT id FROM statuses WHERE kind = 'system')`,
	).run(bookingFallback.id)
}

if (!hasColumn("users", "resident_id")) {
	const migrateUsers = db.transaction(() => {
		db.exec(`
			CREATE TABLE users_new (
				id            INTEGER PRIMARY KEY AUTOINCREMENT,
				username      TEXT NOT NULL UNIQUE,
				password_hash TEXT NOT NULL,
				full_name     TEXT,
				role          TEXT NOT NULL CHECK (role IN ('admin','editor','viewer','resident')),
				resident_id   INTEGER REFERENCES residents(id) ON DELETE SET NULL,
				created_at    TEXT NOT NULL DEFAULT (datetime('now'))
			);
			INSERT INTO users_new (id, username, password_hash, full_name, role, created_at)
				SELECT id, username, password_hash, full_name, role, created_at FROM users;
			DROP TABLE users;
			ALTER TABLE users_new RENAME TO users;
		`)
	})
	db.pragma("foreign_keys = OFF")
	migrateUsers()
	db.pragma("foreign_keys = ON")
}

addColumn("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0")
db.exec("CREATE INDEX IF NOT EXISTS idx_users_resident ON users(resident_id)")
try {
	db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_resident ON users(resident_id) WHERE resident_id IS NOT NULL")
} catch {}

// Роль 'resident' переименована в 'viewer' (конечный пользователь, портал /me)
db.prepare("UPDATE users SET role = 'viewer' WHERE role = 'resident'").run()

// Роль 'observer' — read-only сотрудник (портал /app без права правки). Для существующих
// БД расширяем CHECK через пересоздание таблицы (SQLite не умеет ALTER CHECK).
const usersDDL = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || ""
if (!usersDDL.includes("'observer'")) {
	const colList = columns("users").map((c) => c.name).join(", ")
	const rebuild = db.transaction(() => {
		db.exec(`
			CREATE TABLE users_new (
				id            INTEGER PRIMARY KEY AUTOINCREMENT,
				username      TEXT NOT NULL UNIQUE,
				password_hash TEXT NOT NULL,
				full_name     TEXT,
				role          TEXT NOT NULL CHECK (role IN ('admin','editor','observer','viewer','resident')),
				resident_id   INTEGER REFERENCES residents(id) ON DELETE SET NULL,
				created_at    TEXT NOT NULL DEFAULT (datetime('now')),
				must_change_password INTEGER NOT NULL DEFAULT 0,
				announcements_seen_at TEXT
			);
			INSERT INTO users_new (${colList}) SELECT ${colList} FROM users;
			DROP TABLE users;
			ALTER TABLE users_new RENAME TO users;
		`)
	})
	db.pragma("foreign_keys = OFF")
	rebuild()
	db.pragma("foreign_keys = ON")
	db.exec("CREATE INDEX IF NOT EXISTS idx_users_resident ON users(resident_id)")
	try {
		db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_resident ON users(resident_id) WHERE resident_id IS NOT NULL")
	} catch {}
}

module.exports = db
