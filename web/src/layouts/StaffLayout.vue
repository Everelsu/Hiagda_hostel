<script setup>
import { ref } from "vue"
import { useRouter } from "vue-router"
import { useAuthStore } from "@/stores/auth"

const router = useRouter()
const auth = useAuthStore()
const theme = ref(document.documentElement.getAttribute("data-theme") || "dark")
const ROLE_LABEL = { admin: "Администратор", editor: "Редактор", viewer: "Просмотр" }

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
	<div class="staff-shell">
		<aside class="sidebar">
			<div class="brand-mark" style="padding: var(--gap-sm) var(--gap-sm) var(--gap-lg)"><span class="dot" /> NochOtel</div>
			<nav class="nav">
				<div class="heading">Основное</div>
				<router-link to="/app/dashboard" active-class="active">📊 Главная</router-link>
				<router-link to="/app/plan" active-class="active">🗺 План этажа</router-link>
				<div class="heading">Номерной фонд</div>
				<router-link to="/app/rooms" active-class="active">🏠 Гостиницы и номера</router-link>
				<router-link to="/app/residents" active-class="active">🧑‍🤝‍🧑 Проживающие</router-link>
				<router-link v-if="auth.can('admin')" to="/app/users" active-class="active">👥 Пользователи</router-link>
				<div class="heading">Ещё</div>
				<a href="/legacy" target="_blank" rel="noopener">🛏 Шахматка · журнал · отчёты</a>
			</nav>
			<div class="sidebar-foot">
				<button class="navbtn" @click="toggleTheme">{{ theme === "dark" ? "☾ Тёмная тема" : "☀ Светлая тема" }}</button>
				<div class="user-box">
					<div class="contrast" style="font-weight: 700">{{ auth.user?.full_name || auth.user?.username }}</div>
					<div class="muted" style="font-size: var(--font-size-xs)">{{ ROLE_LABEL[auth.user?.role] }}</div>
				</div>
				<button class="navbtn" @click="logout">⎋ Выход</button>
			</div>
		</aside>
		<main class="content">
			<router-view />
		</main>
	</div>
</template>

<style scoped>
.staff-shell {
	display: grid;
	grid-template-columns: 240px 1fr;
	min-height: 100vh;
}
.sidebar {
	background: var(--color-raised-bg);
	border-right: 1px solid var(--color-divider);
	padding: var(--gap-lg) var(--gap-md);
	display: flex;
	flex-direction: column;
}
.nav {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 2px;
}
.heading {
	font-size: var(--font-size-xs);
	text-transform: uppercase;
	color: var(--color-secondary);
	margin: var(--gap-md) var(--gap-sm) var(--gap-xs);
	letter-spacing: 0.04em;
}
.nav a,
.navbtn {
	display: block;
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
.nav a:hover,
.navbtn:hover {
	background: var(--color-button-bg);
}
.nav a.active {
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	font-weight: var(--font-weight-bold);
}
.sidebar-foot {
	display: grid;
	gap: 2px;
	border-top: 1px solid var(--color-divider);
	padding-top: var(--gap-md);
}
.user-box {
	padding: var(--gap-sm) var(--gap-md);
}
.content {
	padding: var(--gap-xl);
	overflow: auto;
}
@media (max-width: 760px) {
	.staff-shell {
		grid-template-columns: 1fr;
	}
	.sidebar {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
	}
	.nav {
		flex-direction: row;
		flex-wrap: wrap;
	}
	.heading {
		display: none;
	}
}
</style>
