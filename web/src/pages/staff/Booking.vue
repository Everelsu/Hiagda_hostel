<script setup>
// Бронирование: шахматка и поиск свободных мест в одном разделе (переключение вкладками).
import { ref } from "vue"
import { useRoute } from "vue-router"
import { Tabs } from "@/ui"
import Rack from "@/pages/staff/Rack.vue"
import Availability from "@/pages/staff/Availability.vue"

const route = useRoute()
// Позволяем открыть сразу на нужной вкладке: /app/rack?tab=free
const tab = ref(route.query.tab === "free" ? "free" : "rack")
const options = [
	{ value: "rack", label: "Шахматка", icon: "calendar" },
	{ value: "free", label: "Свободные места", icon: "search" },
]
</script>

<template>
	<div class="grid">
		<Tabs v-model="tab" :options="options" />
		<Rack v-if="tab === 'rack'" />
		<Availability v-else />
	</div>
</template>
