<script setup>
// История размещений: журнал всех заселений и лента заездов/выездов за день — в одном разделе.
import { ref } from "vue"
import { Tabs } from "@/ui"
import Journal from "@/pages/staff/Journal.vue"
import Movements from "@/pages/staff/Movements.vue"

const tab = ref("journal")
const options = [
	{ value: "journal", label: "Журнал размещений", icon: "book" },
	{ value: "moves", label: "Заезды / выезды", icon: "key" },
]
</script>

<template>
	<div class="grid">
		<Tabs v-model="tab" :options="options" />
		<Journal v-if="tab === 'journal'" />
		<Movements v-else />
	</div>
</template>
