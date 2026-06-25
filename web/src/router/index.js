import { createRouter, createWebHistory } from "vue-router"
import { useAuthStore } from "@/stores/auth"

const routes = [
	{ path: "/login", name: "login", component: () => import("@/pages/Login.vue"), meta: { public: true } },
	{ path: "/find", name: "find", component: () => import("@/pages/Find.vue"), meta: { public: true } },
	{
		path: "/me",
		component: () => import("@/layouts/ResidentLayout.vue"),
		meta: { resident: true },
		children: [
			{ path: "", name: "resident-home", component: () => import("@/pages/resident/Overview.vue") },
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
			{ path: "plan", name: "plan", component: () => import("@/pages/staff/Plan.vue") },
			{ path: "rooms", name: "roomfund", component: () => import("@/pages/staff/RoomFund.vue") },
			{ path: "residents", name: "residents", component: () => import("@/pages/staff/Residents.vue") },
			{ path: "users", name: "users", component: () => import("@/pages/staff/Users.vue") },
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
	if (to.meta.staff && !auth.isStaff) return "/me"
	if (to.meta.resident && !auth.isResident) return "/app"
	if (to.name === "root") return auth.homeRoute
	return true
})

export default router
