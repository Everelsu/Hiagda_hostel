<script setup>
import { ref, onMounted } from "vue"
import { useOverview } from "@/api/me"

const { load } = useOverview()
const data = ref(null)
onMounted(async () => {
	data.value = await load()
})
</script>

<template>
	<div class="grid" v-if="data">
		<router-link to="/me" class="back">‹ Назад</router-link>
		<h1>Соседи по комнате</h1>

		<div class="card">
			<p v-if="!data.roommates.length" class="muted">Вы живёте один.</p>
			<div v-else class="grid" style="gap: var(--gap-sm)">
				<div v-for="r in data.roommates" :key="r.id" class="roommate">
					<div class="avatar">{{ r.full_name.charAt(0) }}</div>
					<div class="grow">
						<div class="contrast" style="font-weight: 700">{{ r.full_name }}</div>
						<div class="muted" style="font-size: var(--font-size-sm)">{{ [r.position, r.company].filter(Boolean).join(" · ") || "—" }} · {{ r.bed_label }}</div>
						<div v-if="r.about" class="muted" style="font-size: var(--font-size-sm); margin-top: 2px">{{ r.about }}</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.back {
	font-weight: 700;
	color: var(--color-secondary);
}
.roommate {
	display: flex;
	gap: var(--gap-md);
	align-items: center;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.avatar {
	width: 2.4rem;
	height: 2.4rem;
	border-radius: var(--radius-max);
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	display: grid;
	place-items: center;
	font-weight: 800;
	flex-shrink: 0;
}
</style>
