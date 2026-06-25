import { defineStore } from "pinia"
import { post, setToken } from "@/api/client"

const RANK = { viewer: 1, editor: 2, admin: 3 }

export const useAuthStore = defineStore("auth", {
	state: () => ({
		user: JSON.parse(localStorage.getItem("noch_user") || "null"),
	}),
	getters: {
		isAuthed: (s) => !!s.user,
		isStaff: (s) => !!RANK[s.user?.role],
		isResident: (s) => s.user?.role === "resident",
		can: (s) => (role) => (RANK[s.user?.role] || 0) >= RANK[role],
		homeRoute: (s) => (s.user?.role === "resident" ? "/me" : RANK[s.user?.role] ? "/app" : "/login"),
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
