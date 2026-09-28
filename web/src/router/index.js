import { createRouter, createWebHistory } from "vue-router"
import { STAFF_NAV } from "@/config/nav"
import { useAuthStore } from "@/stores/auth"

const routes = [
	{ path: "/login", name: "login", component: () => import("@/pages/Login.vue"), meta: { public: true } },
	{
		path: "/me",
		component: () => import("@/layouts/ResidentLayout.vue"),
		meta: { user: true },
		children: [
			{ path: "", name: "resident-home", component: () => import("@/pages/resident/Home.vue") },
			{ path: "room", name: "resident-room", component: () => import("@/pages/resident/Room.vue") },
			{ path: "plan", name: "resident-plan", component: () => import("@/pages/resident/Plan.vue") },
			// «Размещение» и «Соседи» переехали внутрь «Мой номер»
			{ path: "placement", redirect: "/me/room" },
			{ path: "roommates", redirect: "/me/room" },
			{ path: "hotel", name: "resident-hotel", component: () => import("@/pages/resident/Hotel.vue") },
			{ path: "issues", name: "resident-issues", component: () => import("@/pages/resident/Issues.vue") },
			{ path: "profile", name: "resident-profile", component: () => import("@/pages/resident/Profile.vue") },
		],
	},
	{
		path: "/app",
		component: () => import("@/layouts/StaffLayout.vue"),
		meta: { staff: true },
		children: [
			{ path: "", redirect: { name: "dashboard" } },
			...(import.meta.env.DEV ? [{ path: "_kit", name: "kit", component: () => import("@/pages/staff/Kit.vue") }] : []),
			{ path: "dashboard", name: "dashboard", component: () => import("@/pages/staff/Dashboard.vue") },
			{ path: "map", name: "map", component: () => import("@/pages/staff/Map.vue") },
			{ path: "rack", name: "rack", component: () => import("@/pages/staff/Booking.vue") },
			{ path: "availability", redirect: "/app/rack?tab=free" },
			{ path: "analytics", name: "analytics", component: () => import("@/pages/staff/Analytics.vue") },
			{ path: "plan", name: "plan", component: () => import("@/pages/staff/Plan.vue") },
			{ path: "issues", name: "issues", component: () => import("@/pages/staff/Issues.vue") },
			{ path: "announcements", name: "announcements", component: () => import("@/pages/staff/Announcements.vue") },
			{ path: "hotels", name: "hotels", component: () => import("@/pages/staff/Hotels.vue") },
			{ path: "catalogs", name: "catalogs", component: () => import("@/pages/staff/Catalogs.vue") },
			{ path: "rooms", redirect: "/app/hotels" },
			{ path: "profiles", name: "profiles", component: () => import("@/pages/staff/Profiles.vue") },
			{ path: "residents", redirect: "/app/profiles" },
			{ path: "users", redirect: "/app/profiles" },
			{ path: "history", name: "history", component: () => import("@/pages/staff/History.vue") },
			{ path: "movements", redirect: "/app/history" },
			{ path: "journal", redirect: "/app/history" },
			{ path: "backups", name: "backups", component: () => import("@/pages/staff/Backups.vue"), meta: { admin: true } },
			{ path: "audit", name: "audit", component: () => import("@/pages/staff/Audit.vue") },
		],
	},
	{ path: "/", name: "root", redirect: () => "/login" },
	{ path: "/:pathMatch(.*)*", redirect: "/" },
]

// Разделы, доступные роли «Ремонтная служба»
const REPAIR_PATHS = ["/app/issues", "/app/plan", "/app/hotels", "/app/map"]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
	const auth = useAuthStore()
	if (to.meta.public) {
		if (auth.isAuthed && to.name === "login") return auth.homeRoute
		return true
	}
	if (!auth.isAuthed) return { name: "login", query: { next: to.fullPath } }
	if (to.meta.staff && !auth.isStaff) return auth.homeRoute
	if (to.meta.user && !auth.isUser) return auth.homeRoute
	// У ремонтника урезанный портал: бронирование, справочники и профили ему не нужны
	if (auth.isRepairOnly && to.meta.staff && !REPAIR_PATHS.some((p) => to.path.startsWith(p))) {
		return auth.homeRoute
	}
	if (to.meta.admin && !auth.can("admin")) return auth.homeRoute
	if (to.name === "root") return auth.homeRoute
	return true
})

// Заголовок вкладки браузера — по разделу: среди десятка вкладок нужную видно сразу
router.afterEach((to) => {
	const item = STAFF_NAV.flatMap((g) => g.items).find((i) => to.path.startsWith(i.to))
	const RESIDENT = { "resident-home": "Главная", "resident-room": "Мой номер", "resident-plan": "План этажа", "resident-hotel": "Дом и посёлок", "resident-issues": "Заявки", "resident-profile": "Профиль" }
	const title = item?.label || RESIDENT[to.name] || (to.name === "login" ? "Вход" : "")
	document.title = title ? `${title} · Хиагда` : "Хиагда — учёт номерного фонда"
})

export default router
