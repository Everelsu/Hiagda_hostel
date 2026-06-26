import { ref } from "vue"
import { api } from "@/api/client"

const overview = ref(null)
let loaded = false

export function useOverview() {
	async function load(force = false) {
		if (!loaded || force) {
			overview.value = await api("/me/overview")
			loaded = true
		}
		return overview.value
	}
	return { overview, load }
}
