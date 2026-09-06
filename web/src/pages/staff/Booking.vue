<script setup>
// Бронирование: календарь броней и поиск свободных мест в одном разделе (переключение вкладками).
import { ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { Tabs } from "@/ui"
import Rack from "@/pages/staff/Rack.vue"
import Availability from "@/pages/staff/Availability.vue"

const route = useRoute()
const router = useRouter()
// Позволяем открыть сразу на нужной вкладке: /app/rack?tab=free
const tab = ref(route.query.tab === "free" ? "free" : "calendar")
const options = [
	{ value: "calendar", label: "Календарь броней", icon: "calendar" },
	{ value: "free", label: "Свободные места", icon: "search" },
]

// Вкладка живёт в адресе: ссылку можно переслать, обновление страницы её не сбрасывает.
watch(tab, (v) => {
	const query = { ...route.query }
	if (v === "free") query.tab = "free"
	else delete query.tab
	router.replace({ query }).catch(() => {})
})
</script>

<template>
	<div class="grid">
		<Tabs v-model="tab" :options="options" />
		<Rack v-if="tab === 'calendar'" />
		<Availability v-else />
	</div>
</template>
