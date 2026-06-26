<script setup>
import { ref } from "vue"
import { useRouter } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import { post } from "@/api/client"
import { toast } from "@/toast"
import Icon from "@/components/Icon.vue"
import Modal from "@/components/Modal.vue"

const router = useRouter()
const auth = useAuthStore()
const theme = ref(document.documentElement.getAttribute("data-theme") || "dark")
const curPass = ref("")
const newPass = ref("")
const busy = ref(false)

function toggleTheme() {
	theme.value = theme.value === "dark" ? "light" : "dark"
	document.documentElement.setAttribute("data-theme", theme.value)
	localStorage.setItem("noch_theme", theme.value)
}
function logout() {
	auth.logout()
	router.push({ name: "login" })
}
async function changePassword() {
	if (newPass.value.length < 4) return toast("Пароль слишком короткий (мин. 4)")
	busy.value = true
	try {
		await post("/me/password", { current: curPass.value, next: newPass.value })
		auth.markPasswordChanged()
		curPass.value = newPass.value = ""
		toast("Пароль изменён")
	} catch (e) {
		toast(e.message)
	} finally {
		busy.value = false
	}
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
				<button class="btn btn-sm btn-ghost" @click="toggleTheme"><Icon :name="theme === 'dark' ? 'moon' : 'sun'" /></button>
				<button class="btn btn-sm" @click="logout">Выход</button>
			</div>
		</header>
		<main class="res-main">
			<router-view />
		</main>

		<Modal v-if="auth.user?.must_change_password" title="Смените пароль для первого входа">
			<p class="muted" style="margin: 0">Для безопасности задайте свой пароль вместо выданного.</p>
			<div class="field"><label>Текущий (выданный) пароль</label><input v-model="curPass" type="password" /></div>
			<div class="field"><label>Новый пароль</label><input v-model="newPass" type="password" /></div>
			<template #foot>
				<button class="btn" @click="logout">Выйти</button>
				<button class="btn btn-primary" :disabled="busy" @click="changePassword">Сохранить и войти</button>
			</template>
		</Modal>
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
