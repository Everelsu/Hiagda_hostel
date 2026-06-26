import { createRouter, createWebHistory } from "vue-router"
import { useAuthStore } from "@/stores/auth"

const routes = [
	{ path: "/login", name: "login", component: () => import("@/pages/Login.vue"), meta: { public: true } },
	{
		path: "/me",
		component: () => import("@/layouts/ResidentLayout.vue"),
		meta: { user: true },
		children: [
			{ path: "", name: "resident-home", component: () => import("@/pages/resident/Home.vue") },
			{ path: "placement", name: "resident-placement", component: () => import("@/pages/resident/Placement.vue") },
			{ path: "roommates", name: "resident-roommates", component: () => import("@/pages/resident/Roommates.vue") },
			{ path: "hotel", name: "resident-hotel", component: () => import("@/pages/resident/Hotel.vue") },
			{ path: "profile", name: "resident-profile", component: () => import("@/pages/resident/Profile.vue") },
		],
	},
	{
		path: "/app",
		component: () => import("@/layouts/StaffLayout.vue"),
		meta: { staff: true },
		children: [
			{ path: "", redirect: { name: "dashboard" } },
			{ path: "dashboard", name: "dashboard", component: () => import("@/pages/staff/Dashboard.vue") },
			{ path: "rack", name: "rack", component: () => import("@/pages/staff/Rack.vue") },
			{ path: "analytics", name: "analytics", component: () => import("@/pages/staff/Analytics.vue") },
			{ path: "availability", name: "availability", component: () => import("@/pages/staff/Availability.vue") },
			{ path: "plan", name: "plan", component: () => import("@/pages/staff/Plan.vue") },
			{ path: "rooms", name: "roomfund", component: () => import("@/pages/staff/RoomFund.vue") },
			{ path: "residents", name: "residents", component: () => import("@/pages/staff/Residents.vue") },
			{ path: "movements", name: "movements", component: () => import("@/pages/staff/Movements.vue") },
			{ path: "journal", name: "journal", component: () => import("@/pages/staff/Journal.vue") },
			{ path: "users", name: "users", component: () => import("@/pages/staff/Users.vue") },
			{ path: "audit", name: "audit", component: () => import("@/pages/staff/Audit.vue") },
		],
	},
	{ path: "/", name: "root", redirect: () => "/login" },
	{ path: "/:pathMatch(.*)*", redirect: "/" },
]

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
	if (to.name === "root") return auth.homeRoute
	return true
})

export default router
