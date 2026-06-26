import { defineStore } from "pinia"
import { post, setToken } from "@/api/client"

// Персонал. viewer — это конечный пользователь (вахтовик), не персонал.
const STAFF_RANK = { editor: 1, admin: 2 }

export const useAuthStore = defineStore("auth", {
	state: () => ({
		user: JSON.parse(localStorage.getItem("noch_user") || "null"),
	}),
	getters: {
		isAuthed: (s) => !!s.user,
		isStaff: (s) => !!STAFF_RANK[s.user?.role],
		isUser: (s) => s.user?.role === "viewer",
		can: (s) => (role) => (STAFF_RANK[s.user?.role] || 0) >= STAFF_RANK[role],
		homeRoute: (s) => (s.user?.role === "viewer" ? "/me" : STAFF_RANK[s.user?.role] ? "/app" : "/login"),
	},
	actions: {
		async login(username, password) {
			const r = await post("/login", { username, password })
			this.setSession(r)
			return r.user
		},
		setSession(r) {
			setToken(r.token)
			this.user = r.user
			localStorage.setItem("noch_user", JSON.stringify(r.user))
		},
		logout() {
			setToken(null)
			localStorage.removeItem("noch_user")
			this.user = null
		},
	},
})
