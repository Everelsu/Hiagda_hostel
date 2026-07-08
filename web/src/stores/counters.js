import { defineStore } from "pinia"
import { api } from "@/api/client"

export const useCounters = defineStore("counters", {
	state: () => ({ newIssues: 0 }),
	actions: {
		async refresh() {
			try {
				this.newIssues = (await api("/me/issues/count")).count || 0
			} catch {}
		},
	},
})
