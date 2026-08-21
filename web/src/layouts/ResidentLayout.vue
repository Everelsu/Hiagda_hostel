<script setup>
import { ref, onMounted } from "vue"
import { useRouter } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import { post } from "@/api/client"
import { toast } from "@/toast"
import { loadFeed, unread } from "@/api/me"
import Icon from "@/components/Icon.vue"
import Modal from "@/components/Modal.vue"

const router = useRouter()
const auth = useAuthStore()
const theme = ref(document.documentElement.getAttribute("data-theme") || "dark")
const curPass = ref("")
const newPass = ref("")
const busy = ref(false)

const tabs = [
	{ to: "/me", exact: true, icon: "home", label: "Главная", badge: true },
	{ to: "/me/room", icon: "bed", label: "Мой номер" },
	{ to: "/me/hotel", icon: "building", label: "Дом" },
	{ to: "/me/issues", icon: "wrench", label: "Заявки" },
	{ to: "/me/profile", icon: "user", label: "Профиль" },
]

onMounted(() => {
	if (auth.user?.resident_id) loadFeed().catch(() => {})
})

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
	if (newPass.value.length < 6) return toast("Пароль слишком короткий (мин. 6 символов)")
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
			<div class="res-top__inner">
				<div class="brand-mark"><span class="dot" /> Хиагда</div>
				<nav class="res-nav">
					<router-link
						v-for="t in tabs"
						:key="t.to"
						:to="t.to"
						:exact-active-class="t.exact ? 'active' : undefined"
						:active-class="t.exact ? '' : 'active'"
					>
						{{ t.label }}
					</router-link>
				</nav>
				<div class="row" style="gap: var(--gap-sm)">
					<button class="btn btn-sm btn-ghost" @click="toggleTheme"><Icon :name="theme === 'dark' ? 'moon' : 'sun'" /></button>
					<button class="btn btn-sm" @click="logout">Выход</button>
				</div>
			</div>
		</header>

		<main class="res-main"><router-view /></main>

		<nav class="tabbar">
			<router-link
				v-for="t in tabs"
				:key="t.to"
				:to="t.to"
				:exact-active-class="t.exact ? 'active' : undefined"
				:active-class="t.exact ? '' : 'active'"
				class="tab"
			>
				<span class="tab-ico">
					<Icon :name="t.icon" size="1.4rem" />
					<span v-if="t.badge && unread > 0" class="tab-badge">{{ unread }}</span>
				</span>
				<span class="tab-label">{{ t.label }}</span>
			</router-link>
		</nav>

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
	min-height: 100dvh;
}
.res-top {
	position: sticky;
	top: 0;
	z-index: 10;
	padding: var(--gap-md) var(--gap-lg);
	background: var(--color-raised-bg);
	border-bottom: 1px solid var(--color-divider);
}
.res-top__inner {
	max-width: 820px;
	margin: 0 auto;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--gap-md);
}
.res-nav {
	display: flex;
	gap: var(--gap-xs);
}
.res-nav a {
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	color: var(--color-base);
	font-weight: var(--font-weight-medium);
	font-size: var(--font-size-sm);
}
.res-nav a.active {
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	font-weight: var(--font-weight-bold);
}
.res-main {
	max-width: 820px;
	margin: 0 auto;
	padding: var(--gap-xl) var(--gap-lg) calc(var(--gap-xl) + 4rem);
}

/* Нижний таб-бар (мобильный) */
.tabbar {
	display: none;
}
.tab-badge {
	position: absolute;
	top: -4px;
	right: -8px;
	min-width: 16px;
	height: 16px;
	padding: 0 4px;
	border-radius: var(--radius-max);
	background: var(--color-red);
	color: #fff;
	font-size: 10px;
	font-weight: 700;
	display: grid;
	place-items: center;
	line-height: 1;
}

@media (max-width: 720px) {
	.res-nav {
		display: none;
	}
	.res-main {
		padding: var(--gap-lg) var(--gap-md) calc(var(--gap-lg) + 4.5rem);
	}
	.tabbar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 20;
		display: flex;
		justify-content: space-around;
		background: var(--color-raised-bg);
		border-top: 1px solid var(--color-divider);
		padding: var(--gap-xs) var(--gap-xs) calc(var(--gap-xs) + env(safe-area-inset-bottom));
	}
	.tab {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: var(--gap-xs) 0;
		color: var(--color-secondary);
		font-size: 11px;
		font-weight: var(--font-weight-medium);
	}
	.tab-ico {
		position: relative;
		display: grid;
		place-items: center;
	}
	.tab.active {
		color: var(--color-brand);
	}
}
</style>
