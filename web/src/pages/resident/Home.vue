<script setup>
import { ref, onMounted, computed } from "vue"
import { useOverview } from "@/api/me"
import Icon from "@/components/Icon.vue"

const { overview, load } = useOverview()
const loading = ref(true)
onMounted(async () => {
	await load(true)
	loading.value = false
})

const cards = computed(() => {
	const o = overview.value
	return [
		{ to: "/me/placement", icon: "bed", title: "Моё размещение", sub: o?.placement ? `№ ${o.placement.room_number} · ${o.placement.bed_label}` : "Нет активного размещения" },
		{ to: "/me/roommates", icon: "users", title: "Соседи по комнате", sub: o?.roommates?.length ? `${o.roommates.length} чел.` : "Вы живёте один" },
		{ to: "/me/placement", icon: "wifi", title: "Что в номере", sub: o?.room?.amenities?.length ? `${o.room.amenities.length} удобств` : "—" },
		{ to: "/me/hotel", icon: "building", title: "О доме и посёлке", sub: o?.hotel?.settlement || o?.hotel?.name || "—" },
		{ to: "/me/profile", icon: "user", title: "Мой профиль", sub: "Данные и пароль" },
	]
})
</script>

<template>
	<div class="grid">
		<div>
			<h1>Здравствуйте, {{ overview?.resident?.full_name || "вахтовик" }}</h1>
			<p class="muted" style="margin-top: 2px">Здесь — всё про ваше проживание</p>
		</div>

		<div v-if="loading" class="muted">Загрузка…</div>
		<div v-else class="hub">
			<router-link v-for="c in cards" :key="c.title" :to="c.to" class="hub-card">
				<span class="hub-ico"><Icon :name="c.icon" size="1.5rem" /></span>
				<span class="grow">
					<span class="hub-title">{{ c.title }}</span>
					<span class="hub-sub">{{ c.sub }}</span>
				</span>
				<Icon name="chevron-right" class="hub-arrow" />
			</router-link>
		</div>
	</div>
</template>

<style scoped>
.hub {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: var(--gap-md);
}
.hub-card {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	padding: var(--gap-lg);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	box-shadow: var(--shadow-card);
	color: var(--color-base);
	transition: border-color 0.15s, transform 0.07s;
}
.hub-card:hover {
	border-color: var(--color-brand);
	transform: translateY(-1px);
}
.hub-ico {
	width: 2.6rem;
	height: 2.6rem;
	display: grid;
	place-items: center;
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	border-radius: var(--radius-md);
	flex-shrink: 0;
}
.hub-title {
	display: block;
	font-weight: 700;
	color: var(--color-contrast);
}
.hub-sub {
	display: block;
	font-size: var(--font-size-sm);
	color: var(--color-secondary);
}
.hub-arrow {
	font-size: 1.5rem;
	color: var(--color-secondary);
}
</style>
