<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import { useRouter, useRoute } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import { useCounters } from "@/stores/counters"
import { onRealtime } from "@/realtime"
import { STAFF_NAV } from "@/config/nav"
import Icon from "@/components/Icon.vue"
import { IconButton, Badge } from "@/ui"

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const counters = useCounters()

const theme = ref(document.documentElement.getAttribute("data-theme") || "dark")
const mobileOpen = ref(false)
const ROLE_LABEL = { admin: "Администратор", editor: "Редактор", observer: "Просмотр", maintenance: "Ремонтная служба", viewer: "Вахтовик" }

// Ремонтнику показываем только его разделы, остальным — всё, кроме админских
const groups = computed(() =>
	STAFF_NAV
		.filter((g) => !g.admin || auth.can("admin"))
		.map((g) => ({ ...g, items: auth.isRepairOnly ? g.items.filter((i) => i.repair) : g.items }))
		.filter((g) => g.items.length),
)
const pageTitle = computed(() => {
	for (const g of STAFF_NAV) for (const i of g.items) if (route.path.startsWith(i.to)) return i.label
	return "NochOtel"
})

function badgeValue(item) {
	return item.badge ? counters[item.badge] : 0
}
function toggleTheme() {
	theme.value = theme.value === "dark" ? "light" : "dark"
	document.documentElement.setAttribute("data-theme", theme.value)
	localStorage.setItem("noch_theme", theme.value)
}
function logout() {
	auth.logout()
	router.push({ name: "login" })
}

onMounted(() => counters.refresh())
watch(() => route.path, () => {
	mobileOpen.value = false
	counters.refresh()
})

// Бейдж заявок должен меняться сразу, а не только при переходе между разделами
const stopRealtime = onRealtime((event) => {
	if (event.type === "issues:changed") counters.refresh()
})
onUnmounted(stopRealtime)
</script>

<template>
	<div class="shell">
		<aside class="sidebar" :class="{ open: mobileOpen }">
			<div class="brand-mark sidebar__brand"><span class="dot" /> Хиагда</div>
			<nav class="nav">
				<template v-for="g in groups" :key="g.heading">
					<div class="nav__heading">{{ g.heading }}</div>
					<router-link v-for="item in g.items" :key="item.to" :to="item.to" active-class="active" class="nav__link">
						<Icon :name="item.icon" />
						<span class="nav__label">{{ item.label }}</span>
						<Badge v-if="badgeValue(item) > 0" variant="danger">{{ badgeValue(item) }}</Badge>
					</router-link>
				</template>
			</nav>
			<div class="sidebar__foot">
				<div class="user-box">
					<div class="contrast" style="font-weight: 700">{{ auth.user?.full_name || auth.user?.username }}</div>
					<div class="muted" style="font-size: var(--font-size-xs)">{{ ROLE_LABEL[auth.user?.role] }}</div>
				</div>
				<button class="navbtn" @click="logout"><Icon name="log-out" /> Выход</button>
			</div>
		</aside>

		<div v-if="mobileOpen" class="scrim" @click="mobileOpen = false" />

		<div class="main">
			<header class="topbar">
				<IconButton class="topbar__burger" icon="layout" label="Меню" @click="mobileOpen = true" />
				<h2 class="topbar__title">{{ pageTitle }}</h2>
				<div class="spacer" />
				<IconButton :icon="theme === 'dark' ? 'moon' : 'sun'" :label="theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'" @click="toggleTheme" />
			</header>
			<main class="content"><router-view /></main>
		</div>
	</div>
</template>

<style scoped>
.shell {
	display: grid;
	grid-template-columns: 240px 1fr;
	height: 100vh;
	height: 100dvh;
	overflow: hidden;
}
.sidebar {
	background: var(--color-raised-bg);
	border-right: 1px solid var(--color-divider);
	padding: var(--gap-lg) var(--gap-md);
	display: flex;
	flex-direction: column;
}
.sidebar__brand {
	padding: var(--gap-sm) var(--gap-sm) var(--gap-lg);
}
.nav {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 2px;
	overflow-y: auto;
}
.nav__heading {
	font-size: var(--font-size-xs);
	text-transform: uppercase;
	color: var(--color-secondary);
	margin: var(--gap-md) var(--gap-sm) var(--gap-xs);
	letter-spacing: 0.04em;
}
.nav__link,
.navbtn {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	text-align: left;
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	color: var(--color-base);
	font-size: var(--font-size-sm);
	font-weight: var(--font-weight-medium);
	border: none;
	background: transparent;
	cursor: pointer;
	font-family: inherit;
}
.nav__label {
	flex: 1;
}
.nav__link:hover,
.navbtn:hover {
	background: var(--color-button-bg);
}
.nav__link.active {
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	font-weight: var(--font-weight-bold);
}
.sidebar__foot {
	display: grid;
	gap: 2px;
	border-top: 1px solid var(--color-divider);
	padding-top: var(--gap-md);
}
.user-box {
	padding: var(--gap-sm) var(--gap-md);
}
.main {
	display: flex;
	flex-direction: column;
	min-width: 0;
	height: 100%;
	overflow: hidden;
}
.topbar {
	position: sticky;
	top: 0;
	z-index: var(--z-sticky);
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	padding: var(--gap-sm) var(--gap-xl);
	background: var(--color-raised-bg);
	border-bottom: 1px solid var(--color-divider);
}
.topbar__title {
	font-size: var(--font-size-lg);
}
.topbar__burger {
	display: none;
}
.spacer {
	flex: 1;
}
.content {
	flex: 1;
	min-height: 0;
	padding: var(--gap-xl);
	overflow: auto;
}
.scrim {
	display: none;
}
@media (max-width: 860px) {
	.shell {
		grid-template-columns: 1fr;
	}
	.sidebar {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		width: 260px;
		z-index: var(--z-drawer);
		transform: translateX(-100%);
		transition: transform var(--speed);
	}
	.sidebar.open {
		transform: translateX(0);
	}
	.scrim {
		display: block;
		position: fixed;
		inset: 0;
		z-index: calc(var(--z-drawer) - 1);
		background: rgba(0, 0, 0, 0.5);
	}
	.topbar__burger {
		display: inline-grid;
	}
	.content {
		padding: var(--gap-lg);
	}
}
</style>
