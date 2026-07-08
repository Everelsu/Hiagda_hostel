// Навигация портала персонала. badge — ключ счётчика из useCounters; admin — только для админа.
export const STAFF_NAV = [
	{
		heading: "Основное",
		items: [
			{ to: "/app/dashboard", icon: "gauge", label: "Главная" },
			{ to: "/app/map", icon: "map", label: "Карта" },
			{ to: "/app/rack", icon: "calendar", label: "Бронирование" },
			{ to: "/app/analytics", icon: "bar-chart", label: "Аналитика" },
			{ to: "/app/plan", icon: "layout", label: "План этажа" },
			{ to: "/app/availability", icon: "search", label: "Свободные места" },
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
		heading: "Номерной фонд",
		items: [
			{ to: "/app/profiles", icon: "users", label: "Профили" },
			{ to: "/app/hotels", icon: "building", label: "Гостиницы и номера" },
			{ to: "/app/catalogs", icon: "tag", label: "Справочники" },
			{ to: "/app/movements", icon: "key", label: "Заезды / выезды" },
			{ to: "/app/journal", icon: "book", label: "Журнал размещений" },
		],
	},
	{
		heading: "Администрирование",
		admin: true,
		items: [{ to: "/app/audit", icon: "info", label: "Журнал действий" }],
	},
]
