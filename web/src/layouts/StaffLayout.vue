<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import { useRoute } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import { useCounters } from "@/stores/counters"
import { onRealtime } from "@/realtime"
import { STAFF_NAV } from "@/config/nav"
import { theme, toggleTheme } from "@/utils/theme"
import Icon from "@/components/Icon.vue"
import BrandMark from "@/components/BrandMark.vue"
import CommandPalette from "@/components/CommandPalette.vue"
import { IconButton, Badge, Avatar } from "@/ui"

const route = useRoute()
const auth = useAuthStore()
const counters = useCounters()

const mobileOpen = ref(false)
const paletteOpen = ref(false)
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
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
	return "Хиагда"
})

const palettePages = computed(() => groups.value.flatMap((g) => g.items.map((i) => ({ ...i, group: g.heading }))))
const paletteActions = computed(() => [
	{ id: "theme", icon: theme.value === "dark" ? "sun" : "moon", label: theme.value === "dark" ? "Светлая тема" : "Тёмная тема", run: toggleTheme },
	{ id: "logout", icon: "log-out", label: "Выйти из системы", run: logout },
])

// Ctrl+K / ⌘K — в любом месте; «/» — когда фокус не в поле ввода
function onGlobalKey(e) {
	const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
	// e.code — физическая клавиша, работает и в русской раскладке (К/Л, «.»)
	if (((e.ctrlKey || e.metaKey) && e.code === "KeyK") || (e.code === "Slash" && !e.shiftKey && !e.ctrlKey && !typing)) {
		e.preventDefault()
		paletteOpen.value = !paletteOpen.value
	}
}
onMounted(() => window.addEventListener("keydown", onGlobalKey))
onUnmounted(() => window.removeEventListener("keydown", onGlobalKey))

function badgeValue(item) {
	return item.badge ? counters[item.badge] : 0
}
function logout() {
	auth.logout()
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
			<div class="brand-mark sidebar__brand"><BrandMark size="1.6rem" /> Хиагда</div>
			<nav class="nav">
				<template v-for="g in groups" :key="g.heading">
					<div class="nav__heading">{{ g.heading }}</div>
					<router-link v-for="item in g.items" :key="item.to" :to="item.to" active-class="active" class="nav__link">
						<Icon :name="item.icon" />
						<span class="nav__label">{{ item.label }}</span>
						<Badge v-if="badgeValue(item) > 0" :key="badgeValue(item)" variant="danger" class="nav__badge">{{ badgeValue(item) }}</Badge>
					</router-link>
				</template>
			</nav>
			<div class="sidebar__foot">
				<div class="user-box">
					<Avatar :name="auth.user?.full_name || auth.user?.username" size="2.1rem" />
					<div class="user-box__text">
						<div class="contrast user-box__name">{{ auth.user?.full_name || auth.user?.username }}</div>
						<div class="muted" style="font-size: var(--font-size-xs)">{{ ROLE_LABEL[auth.user?.role] }}</div>
					</div>
				</div>
				<button class="navbtn" @click="logout"><Icon name="log-out" /> Выход</button>
			</div>
		</aside>

		<div v-if="mobileOpen" class="scrim" @click="mobileOpen = false" />

		<div class="main">
			<header class="topbar">
				<IconButton class="topbar__burger" icon="menu" label="Меню" @click="mobileOpen = true" />
				<h2 class="topbar__title">{{ pageTitle }}</h2>
				<button type="button" class="topsearch" @click="paletteOpen = true">
					<Icon name="search" />
					<span class="topsearch__text">Поиск разделов и вахтовиков…</span>
					<kbd>{{ isMac ? "⌘" : "Ctrl" }} K</kbd>
				</button>
				<div class="spacer" />
				<IconButton :icon="theme === 'dark' ? 'moon' : 'sun'" :label="theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'" @click="toggleTheme" />
			</header>
			<main class="content">
				<router-view v-slot="{ Component, route: r }">
					<Transition name="page" mode="out-in"><component :is="Component" :key="r.path" /></Transition>
				</router-view>
			</main>
		</div>

		<CommandPalette v-model="paletteOpen" :pages="palettePages" :actions="paletteActions" :search-residents="!auth.isRepairOnly" />
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
.nav__badge {
	animation: badge-pop 420ms cubic-bezier(0.3, 1.6, 0.5, 1);
}
@keyframes badge-pop {
	from {
		transform: scale(0.4);
	}
}
.nav__link {
	transition: background-color var(--speed-fast), color var(--speed-fast);
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
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-sm) var(--gap-sm);
	min-width: 0;
}
.user-box__text {
	min-width: 0;
}
.user-box__name {
	font-weight: 700;
	font-size: var(--font-size-sm);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.topsearch {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	width: min(420px, 100%);
	height: var(--control-h-md);
	padding: 0 var(--gap-sm) 0 var(--gap-md);
	border: 1px solid var(--color-button-border);
	border-radius: var(--radius-md);
	background: var(--color-bg);
	color: var(--color-secondary);
	font: inherit;
	font-size: var(--font-size-sm);
	cursor: pointer;
	transition: border-color var(--speed-fast), color var(--speed-fast);
}
.topsearch:hover {
	border-color: var(--color-brand);
	color: var(--color-contrast);
}
.topsearch__text {
	flex: 1;
	text-align: left;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.topsearch kbd {
	padding: 0 6px;
	border: 1px solid var(--color-button-border);
	border-bottom-width: 2px;
	border-radius: 5px;
	font-family: inherit;
	font-size: 0.7rem;
	line-height: 1.6;
}
/* На десктопе название раздела уже крупно в шапке страницы — сверху оставляем поиск */
@media (min-width: 861px) {
	.topbar__title {
		display: none;
	}
}
.page-enter-active,
.page-leave-active {
	transition: opacity 120ms ease, transform 120ms ease;
}
.page-enter-from {
	opacity: 0;
	transform: translateY(4px);
}
.page-leave-to {
	opacity: 0;
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
	.topsearch {
		width: auto;
		border: none;
		background: transparent;
		padding: 0 var(--gap-sm);
	}
	.topsearch__text,
	.topsearch kbd {
		display: none;
	}
	.content {
		padding: var(--gap-lg);
	}
}
</style>
