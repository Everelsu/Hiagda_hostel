<script setup>
import { ref, onMounted } from "vue"
import { useOverview } from "@/api/me"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, ListRow, Avatar, EmptyState } from "@/ui"

const { load } = useOverview()
const data = ref(null)
onMounted(async () => {
	data.value = await load()
})
</script>

<template>
	<div class="grid" v-if="data">
		<PageHeader title="Соседи по комнате" icon="users" :back="'/me'" />

		<Card v-if="!data.roommates.length"><EmptyState icon="users" title="Вы живёте один" text="В комнате пока нет других жильцов" /></Card>
		<div v-else class="grid" style="gap: var(--gap-sm)">
			<ListRow v-for="r in data.roommates" :key="r.id">
				<template #lead><Avatar :src="r.photo" :name="r.full_name" size="2.8rem" /></template>
				<template #title>{{ r.full_name }}</template>
				<template #sub>
					{{ [r.position, r.company].filter(Boolean).join(" · ") || "—" }} · {{ r.bed_label }}
					<span v-if="r.about" style="display: block">{{ r.about }}</span>
					<a v-if="r.phone" :href="`tel:${r.phone}`" class="phone"><Icon name="phone" size="0.9em" /> {{ r.phone }}</a>
				</template>
			</ListRow>
		</div>
	</div>
</template>

<style scoped>
.phone {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	margin-top: 4px;
	font-weight: 600;
}
</style>
