// Навигация портала персонала. badge — ключ счётчика из useCounters; admin — только для админа.
export const STAFF_NAV = [
	{
		heading: "Основное",
		items: [
			{ to: "/app/dashboard", icon: "gauge", label: "Главная" },
			{ to: "/app/rack", icon: "calendar", label: "Бронирование" },
			{ to: "/app/map", icon: "map", label: "Карта" },
			{ to: "/app/analytics", icon: "bar-chart", label: "Аналитика" },
		],
	},
	{
		heading: "Номерной фонд",
		items: [
			{ to: "/app/hotels", icon: "building", label: "Гостиницы и номера" },
			{ to: "/app/plan", icon: "layout", label: "План этажа" },
			{ to: "/app/profiles", icon: "users", label: "Профили" },
			{ to: "/app/catalogs", icon: "tag", label: "Справочники" },
			{ to: "/app/history", icon: "book", label: "История размещений" },
		],
	},
	{
		heading: "Общение",
		items: [
			{ to: "/app/issues", icon: "wrench", label: "Заявки на ремонт", badge: "newIssues" },
			{ to: "/app/announcements", icon: "megaphone", label: "Объявления" },
		],
	},
	{
		heading: "Администрирование",
		admin: true,
		items: [{ to: "/app/audit", icon: "info", label: "Журнал действий" }],
	},
]
