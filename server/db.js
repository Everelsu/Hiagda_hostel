const path = require("node:path")
const fs = require("node:fs")
const Database = require("better-sqlite3")

const dataDir = path.join(__dirname, "..", "data")
fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(path.join(dataDir, "nochotel.db"))
db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")

db.exec(`
	CREATE TABLE IF NOT EXISTS users (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		username      TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		full_name     TEXT,
		role          TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
		created_at    TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS hotels (
		id       INTEGER PRIMARY KEY AUTOINCREMENT,
		name     TEXT NOT NULL,
		location TEXT
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
		note       TEXT
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

	CREATE TABLE IF NOT EXISTS audit_log (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id    INTEGER,
		username   TEXT,
		method     TEXT NOT NULL,
		path       TEXT NOT NULL,
		summary    TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
	CREATE INDEX IF NOT EXISTS idx_rooms_hotel ON rooms(hotel_id);
	CREATE INDEX IF NOT EXISTS idx_beds_room ON beds(room_id);
	CREATE INDEX IF NOT EXISTS idx_placements_bed ON placements(bed_id);
	CREATE INDEX IF NOT EXISTS idx_placements_dates ON placements(date_from, date_to);
`)

const placementCols = db.prepare("PRAGMA table_info(placements)").all()
if (!placementCols.some((c) => c.name === "stage")) {
	db.exec(
		"ALTER TABLE placements ADD COLUMN stage TEXT NOT NULL DEFAULT 'expected' " +
			"CHECK (stage IN ('expected','checked_in','checked_out','cancelled'))",
	)
	db.prepare(
		`UPDATE placements SET stage = 'checked_in'
		 WHERE status_id IN (SELECT id FROM statuses WHERE name LIKE '%рожива%')`,
	).run()
}
db.exec("CREATE INDEX IF NOT EXISTS idx_placements_stage ON placements(stage)")

module.exports = db
