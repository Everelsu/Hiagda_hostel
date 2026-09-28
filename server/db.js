const { Pool, types } = require("pg")

// ── Типы ──────────────────────────────────────────────────────────────────────
// Драйвер pg по умолчанию отдаёт BIGINT и NUMERIC строками (чтобы не терять точность
// на больших числах). Для нас это ломало бы всё разом: COUNT(*) приезжал бы как "0",
// и проверки вида `count === 0` вместе с арифметикой `avg * 10` молча врали бы.
// Числа здесь заведомо в пределах double, поэтому приводим сразу к number.
types.setTypeParser(20, (v) => (v === null ? null : Number(v))) // int8 (COUNT)
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))) // numeric (AVG/SUM)

// ── Подключение ───────────────────────────────────────────────────────────────
// Приоритет: DATABASE_URL (одной строкой, удобно для systemd), иначе PG*-переменные.
const config = process.env.DATABASE_URL
	? { connectionString: process.env.DATABASE_URL }
	: {
			host: process.env.PGHOST || "127.0.0.1",
			port: Number(process.env.PGPORT) || 5432,
			database: process.env.PGDATABASE || "nochotel",
			user: process.env.PGUSER || "nochotel",
			password: process.env.PGPASSWORD || "",
		}

const pool = new Pool({
	...config,
	max: Number(process.env.PGPOOL_MAX) || 10,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 10000,
	application_name: "nochotel",
})

// Без этого обработчика обрыв простаивающего соединения (перезапуск СУБД, файрвол)
// роняет весь процесс: pg эмитит 'error' на пуле, а необработанный 'error' фатален.
pool.on("error", (err) => console.error("PostgreSQL: ошибка простаивающего соединения:", err.message))

// ── Совместимость с прежним синтаксисом запросов ──────────────────────────────
// Код писался под better-sqlite3: плейсхолдеры «?» и db.prepare(sql).get/all/run(...).
// Оставляем ту же форму вызова (теперь асинхронную), а «?» переводим в «$1, $2…»
// здесь. Разбор посимвольный, потому что «?» внутри строкового литерала или
// SQL-комментария плейсхолдером не является.
function toPlaceholders(sql) {
	let out = ""
	let i = 0
	let n = 0
	while (i < sql.length) {
		const ch = sql[i]
		if (ch === "'") {
			let j = i + 1
			while (j < sql.length) {
				if (sql[j] === "'" && sql[j + 1] === "'") {
					j += 2
					continue
				}
				if (sql[j] === "'") {
					j++
					break
				}
				j++
			}
			out += sql.slice(i, j)
			i = j
			continue
		}
		if (ch === "-" && sql[i + 1] === "-") {
			const nl = sql.indexOf("\n", i)
			const end = nl === -1 ? sql.length : nl
			out += sql.slice(i, end)
			i = end
			continue
		}
		if (ch === "?") {
			out += "$" + ++n
			i++
			continue
		}
		out += ch
		i++
	}
	return out
}

// Таблицы-связки без собственного id — им RETURNING id не приписываем.
const ID_LESS_TABLES = new Set(["room_amenities", "hotel_amenities", "floor_images", "settings"])

// В better-sqlite3 .run() возвращал lastInsertRowid. В PostgreSQL эквивалента нет,
// поэтому к INSERT'ам дописываем RETURNING id и достаём его из результата.
function withReturning(sql) {
	const m = /^\s*INSERT\s+INTO\s+"?([a-z_]+)"?/i.exec(sql)
	if (!m || /\bRETURNING\b/i.test(sql)) return sql
	if (ID_LESS_TABLES.has(m[1].toLowerCase())) return sql
	return `${sql} RETURNING id`
}

function makeStatement(exec, sql) {
	const readText = toPlaceholders(sql)
	const writeText = toPlaceholders(withReturning(sql))
	return {
		get: async (...params) => (await exec(readText, params)).rows[0],
		all: async (...params) => (await exec(readText, params)).rows,
		run: async (...params) => {
			const r = await exec(writeText, params)
			return { lastInsertRowid: r.rows?.[0]?.id, changes: r.rowCount }
		},
	}
}

const poolExec = (text, params) => pool.query(text, params)

const db = {
	prepare: (sql) => makeStatement(poolExec, sql),
	exec: (sql) => pool.query(sql),
	query: (text, params) => pool.query(text, params),

	// Транзакция на выделенном соединении. Внутри колбэка пользуйтесь ПЕРЕДАННЫМ tx,
	// а не глобальным db: запросы через db уйдут в другое соединение пула, не увидят
	// незакоммиченных изменений, а при откате останутся применёнными.
	tx: async (fn) => {
		const client = await pool.connect()
		const scoped = {
			prepare: (sql) => makeStatement((t, p) => client.query(t, p), sql),
			exec: (sql) => client.query(sql),
			query: (t, p) => client.query(t, p),
		}
		try {
			await client.query("BEGIN")
			const result = await fn(scoped)
			await client.query("COMMIT")
			return result
		} catch (e) {
			try {
				await client.query("ROLLBACK")
			} catch {}
			throw e
		} finally {
			client.release()
		}
	},

	close: () => pool.end(),
}

// ── Схема ─────────────────────────────────────────────────────────────────────
// Единый финальный вид схемы: в SQLite она доращивалась цепочкой ALTER'ов, здесь
// таблицы сразу создаются в актуальном виде. Порядок важен — внешние ключи в
// PostgreSQL требуют, чтобы таблица-цель уже существовала.
//
// Даты (date_from/date_to) и отметки времени сознательно остаются TEXT: в приложении
// они везде сравниваются как строки «ГГГГ-ММ-ДД», и перевод в DATE потребовал бы
// переписать всю арифметику дат и фронтенд. У ISO-строк сортировка и сравнение
// совпадают с датными, так что поведение остаётся прежним.
const NOW_UTC = "to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')"

const SCHEMA = `
CREATE TABLE IF NOT EXISTS residents (
	id            INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	full_name     TEXT NOT NULL,
	tab_number    TEXT,
	company       TEXT,
	department    TEXT,
	position      TEXT,
	phone         TEXT,
	note          TEXT,
	about         TEXT,
	photo         TEXT,
	show_contacts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hotels (
	id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	name        TEXT NOT NULL,
	location    TEXT,
	settlement  TEXT,
	address     TEXT,
	phone       TEXT,
	email       TEXT,
	check_in    TEXT,
	check_out   TEXT,
	latitude    TEXT,
	longitude   TEXT,
	description TEXT,
	rules       TEXT
);

CREATE TABLE IF NOT EXISTS room_classes (
	id   INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS statuses (
	id    INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	name  TEXT NOT NULL UNIQUE,
	color TEXT NOT NULL,
	sort  INTEGER NOT NULL DEFAULT 0,
	kind  TEXT NOT NULL DEFAULT 'booking',
	code  TEXT
);

CREATE TABLE IF NOT EXISTS amenities (
	id    INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	name  TEXT NOT NULL UNIQUE,
	icon  TEXT NOT NULL DEFAULT 'dot',
	scope TEXT NOT NULL DEFAULT 'both' CHECK (scope IN ('room','hotel','both'))
);

CREATE TABLE IF NOT EXISTS rooms (
	id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	hotel_id    INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
	class_id    INTEGER REFERENCES room_classes(id) ON DELETE SET NULL,
	number      TEXT NOT NULL,
	floor       INTEGER,
	capacity    INTEGER NOT NULL DEFAULT 1,
	description TEXT,
	plan_x      INTEGER,
	plan_y      INTEGER,
	plan_w      INTEGER,
	plan_h      INTEGER,
	plan_cells  TEXT
);

CREATE TABLE IF NOT EXISTS beds (
	id      INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
	label   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
	id                    INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	username              TEXT NOT NULL UNIQUE,
	password_hash         TEXT NOT NULL,
	full_name             TEXT,
	role                  TEXT NOT NULL CHECK (role IN ('admin','editor','observer','maintenance','viewer','resident')),
	resident_id           INTEGER REFERENCES residents(id) ON DELETE SET NULL,
	created_at            TEXT NOT NULL DEFAULT ${NOW_UTC},
	must_change_password  INTEGER NOT NULL DEFAULT 0,
	announcements_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS placements (
	id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	bed_id      INTEGER NOT NULL REFERENCES beds(id) ON DELETE CASCADE,
	resident_id INTEGER REFERENCES residents(id) ON DELETE SET NULL,
	status_id   INTEGER NOT NULL REFERENCES statuses(id) ON DELETE RESTRICT,
	stage       TEXT NOT NULL DEFAULT 'expected'
		CHECK (stage IN ('expected','checked_in','checked_out','cancelled')),
	date_from   TEXT NOT NULL,
	date_to     TEXT NOT NULL,
	comment     TEXT,
	created_at  TEXT NOT NULL DEFAULT ${NOW_UTC}
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
	id        INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	hotel_id  INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
	name      TEXT NOT NULL,
	kind      TEXT,
	note      TEXT,
	distance  TEXT,
	latitude  TEXT,
	longitude TEXT,
	icon      TEXT
);

CREATE TABLE IF NOT EXISTS images (
	id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	owner_type TEXT NOT NULL CHECK (owner_type IN ('hotel','room')),
	owner_id   INTEGER NOT NULL,
	url        TEXT NOT NULL,
	sort       INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT ${NOW_UTC}
);

CREATE TABLE IF NOT EXISTS reviews (
	id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	hotel_id    INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
	room_id     INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
	resident_id INTEGER REFERENCES residents(id) ON DELETE SET NULL,
	rating      INTEGER NOT NULL,
	text        TEXT,
	reply       TEXT,
	reply_at    TEXT,
	created_at  TEXT NOT NULL DEFAULT ${NOW_UTC}
);

CREATE TABLE IF NOT EXISTS room_blocks (
	id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
	date_from  TEXT NOT NULL,
	date_to    TEXT NOT NULL,
	reason     TEXT,
	created_at TEXT NOT NULL DEFAULT ${NOW_UTC}
);

CREATE TABLE IF NOT EXISTS room_issues (
	id           INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	room_id      INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
	user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
	amenity_name TEXT NOT NULL,
	comment      TEXT NOT NULL,
	photo        TEXT,
	status       TEXT NOT NULL DEFAULT 'Новая'
		CHECK (status IN ('Новая', 'В работе', 'Починено')),
	created_at   TEXT NOT NULL DEFAULT ${NOW_UTC}
);

CREATE TABLE IF NOT EXISTS plan_shapes (
	id       INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
	floor    INTEGER NOT NULL DEFAULT 1,
	kind     TEXT NOT NULL DEFAULT 'other',
	label    TEXT,
	x        INTEGER NOT NULL DEFAULT 0,
	y        INTEGER NOT NULL DEFAULT 0,
	w        INTEGER NOT NULL DEFAULT 2,
	h        INTEGER NOT NULL DEFAULT 2,
	cells    TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
	id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	user_id    INTEGER,
	username   TEXT,
	method     TEXT NOT NULL,
	path       TEXT NOT NULL,
	summary    TEXT,
	created_at TEXT NOT NULL DEFAULT ${NOW_UTC}
);

CREATE TABLE IF NOT EXISTS announcements (
	id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	hotel_id   INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
	title      TEXT NOT NULL,
	body       TEXT NOT NULL,
	pinned     INTEGER NOT NULL DEFAULT 0,
	created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
	created_at TEXT NOT NULL DEFAULT ${NOW_UTC}
);

CREATE TABLE IF NOT EXISTS issue_comments (
	id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	issue_id   INTEGER NOT NULL REFERENCES room_issues(id) ON DELETE CASCADE,
	user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
	text       TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT ${NOW_UTC}
);

CREATE TABLE IF NOT EXISTS hotel_info_sections (
	id       INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
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
CREATE INDEX IF NOT EXISTS idx_users_resident ON users(resident_id);
CREATE INDEX IF NOT EXISTS idx_residents_tab ON residents(tab_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_statuses_code ON statuses(code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_resident ON users(resident_id) WHERE resident_id IS NOT NULL;
`

// Догоняющие изменения для баз, созданных предыдущими версиями схемы.
// Идемпотентны: на свежей базе не делают ничего.
const PATCHES = `
ALTER TABLE residents ADD COLUMN IF NOT EXISTS department TEXT;
-- Статус (цвет ленты) привязывается к стадии брони: сменили стадию — сменился цвет.
-- Раньше это были два независимых поля, и «Заселить» оставляло ленту цвета «Забронировано».
ALTER TABLE statuses ADD COLUMN IF NOT EXISTS stage TEXT;
-- Фото этажа: план эвакуации или снимок схемы. Сама картинка — в data/uploads (попадает в бэкап
-- вместе с остальными файлами), здесь только ссылка.
CREATE TABLE IF NOT EXISTS floor_images (
	hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
	floor    INTEGER NOT NULL,
	url      TEXT NOT NULL,
	PRIMARY KEY (hotel_id, floor)
);
-- Служебные настройки (ключи пуш-уведомлений) и подписки устройств на пуши
CREATE TABLE IF NOT EXISTS settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
	id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	endpoint   TEXT NOT NULL UNIQUE,
	p256dh     TEXT NOT NULL,
	auth       TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT ${NOW_UTC}
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_statuses_stage ON statuses(stage) WHERE stage IS NOT NULL;
UPDATE statuses SET stage = 'expected'
 WHERE id = (SELECT MIN(id) FROM statuses WHERE kind = 'booking' AND stage IS NULL AND name ILIKE '%брон%')
   AND NOT EXISTS (SELECT 1 FROM statuses WHERE stage = 'expected');
UPDATE statuses SET stage = 'checked_in'
 WHERE id = (SELECT MIN(id) FROM statuses WHERE kind = 'booking' AND stage IS NULL AND name ILIKE '%рожива%')
   AND NOT EXISTS (SELECT 1 FROM statuses WHERE stage = 'checked_in');
`

const SYSTEM_STATUSES = `
INSERT INTO statuses (name, color, sort, kind, code) VALUES
	('Свободно', '#3a3f47', 90, 'system', 'free'),
	('Ремонт',   '#ff8a5c', 91, 'system', 'repair')
-- uq_statuses_code — частичный индекс, поэтому в ON CONFLICT нужно повторить его условие,
-- иначе PostgreSQL не находит подходящего ограничения.
ON CONFLICT (code) WHERE code IS NOT NULL DO NOTHING
`

// Защита от двойной брони на уровне СУБД. Раньше от неё спасало то, что better-sqlite3
// работал синхронно и запросы не чередовались. На пуле PostgreSQL два одновременных
// бронирования могут пройти проверку в коде одновременно, поэтому пересечение должно
// ловиться и на вставке. Диапазон полуоткрытый '[)': день выезда свободен для заезда.
const NO_OVERLAP = `
-- Выражение индекса обязано быть IMMUTABLE, а и приведение date_from::date, и сам
-- to_date() помечены лишь STABLE (их результат в общем случае зависит от DateStyle
-- и lc_time). С жёстко заданным форматом 'YYYY-MM-DD' и ISO-строками на входе
-- разбор от настроек сеанса не зависит, поэтому заворачиваем его в собственную
-- функцию и помечаем IMMUTABLE честно.
CREATE OR REPLACE FUNCTION nochotel_ymd(text) RETURNS date
	LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
	AS $fn$ SELECT to_date($1, 'YYYY-MM-DD') $fn$;

DO $do$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'placements_no_overlap') THEN
		ALTER TABLE placements ADD CONSTRAINT placements_no_overlap
		EXCLUDE USING gist (
			bed_id WITH =,
			daterange(nochotel_ymd(date_from), nochotel_ymd(date_to), '[)') WITH &&
		) WHERE (stage <> 'cancelled');
	END IF;
END
$do$
`

async function init() {
	// Схему поднимает только один процесс: при параллельном старте (systemd + npm run seed)
	// два CREATE INDEX по одному имени дают гонку и падение одного из них.
	const lock = await pool.connect()
	try {
		await lock.query("SELECT pg_advisory_lock(415092001)")
		await lock.query(SCHEMA)
		await lock.query(PATCHES)
		await lock.query(SYSTEM_STATUSES)
		try {
			await lock.query("CREATE EXTENSION IF NOT EXISTS btree_gist")
			await lock.query(NO_OVERLAP)
		} catch (e) {
			// Не критично: проверка пересечений есть и в коде. Но если ограничение не
			// встало (нет прав на CREATE EXTENSION либо в данных уже есть накладки) —
			// это должно быть видно в логе, а не проглочено.
			console.warn("PostgreSQL: защита от двойной брони не включена:", e.message)
		}
	} finally {
		try {
			await lock.query("SELECT pg_advisory_unlock(415092001)")
		} catch {}
		lock.release()
	}
}

// Всё, что обращается к БД, обязано дождаться этого промиса.
db.ready = init()

module.exports = db
