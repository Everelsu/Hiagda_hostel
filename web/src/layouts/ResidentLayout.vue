<script setup>
import { ref } from "vue"
import { useRouter } from "vue-router"
import { useAuthStore } from "@/stores/auth"

const router = useRouter()
const auth = useAuthStore()
const theme = ref(document.documentElement.getAttribute("data-theme") || "dark")

function toggleTheme() {
	theme.value = theme.value === "dark" ? "light" : "dark"
	document.documentElement.setAttribute("data-theme", theme.value)
	localStorage.setItem("noch_theme", theme.value)
}
function logout() {
	auth.logout()
	router.push({ name: "login" })
}
</script>

<template>
	<div class="res-shell">
		<header class="res-top">
			<div class="brand-mark"><span class="dot" /> NochOtel</div>
			<nav class="res-nav">
				<router-link to="/me" exact-active-class="active">Главная</router-link>
				<router-link to="/me/profile" active-class="active">Профиль</router-link>
			</nav>
			<div class="row" style="gap: var(--gap-sm)">
				<button class="btn btn-sm btn-ghost" @click="toggleTheme">{{ theme === "dark" ? "☾" : "☀" }}</button>
				<button class="btn btn-sm" @click="logout">Выход</button>
			</div>
		</header>
		<main class="res-main">
			<router-view />
		</main>
	</div>
</template>

<style scoped>
.res-shell {
	min-height: 100vh;
}
.res-top {
	position: sticky;
	top: 0;
	z-index: 10;
	display: flex;
	align-items: center;
	gap: var(--gap-lg);
	padding: var(--gap-md) var(--gap-lg);
	background: var(--color-raised-bg);
	border-bottom: 1px solid var(--color-divider);
}
.res-nav {
	display: flex;
	gap: var(--gap-md);
	flex: 1;
}
.res-nav a {
	color: var(--color-secondary);
	font-weight: var(--font-weight-bold);
	font-size: var(--font-size-sm);
	padding: var(--gap-xs) var(--gap-sm);
	border-radius: var(--radius-sm);
}
.res-nav a.active {
	color: var(--color-brand);
	background: var(--color-brand-highlight);
}
.res-main {
	max-width: 920px;
	margin: 0 auto;
	padding: var(--gap-xl) var(--gap-lg);
}
@media (max-width: 600px) {
	.res-top {
		flex-wrap: wrap;
	}
}
</style>
