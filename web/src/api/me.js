import { ref } from "vue"
import { api, post } from "@/api/client"

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

export const feed = ref(null)
export const unread = ref(0)

export async function loadFeed(force = false) {
	if (!feed.value || force) {
		feed.value = await api("/me/feed")
		unread.value = feed.value.unread || 0
	}
	return feed.value
}

export async function markAnnouncementsSeen() {
	if (!unread.value) return
	try {
		await post("/me/announcements/seen")
	} catch {}
	unread.value = 0
	if (feed.value) feed.value.unread = 0
}
