<script setup>
import { ref, onMounted } from "vue"
import { useRouter, useRoute } from "vue-router"
import { api, post } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import { Button, Field, Input } from "@/ui"

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const username = ref("")
const password = ref("")
const fullName = ref("")
const needsSetup = ref(false)
const err = ref("")
const busy = ref(false)

onMounted(async () => {
	try {
		needsSetup.value = (await api("/setup-status")).needsSetup
	} catch {}
})

async function submit() {
	err.value = ""
	busy.value = true
	try {
		if (needsSetup.value) {
			const r = await post("/register-admin", { username: username.value, password: password.value, full_name: fullName.value })
			auth.setSession(r)
		} else {
			await auth.login(username.value, password.value)
		}
		router.push(route.query.next || auth.homeRoute)
	} catch (e) {
		err.value = e.message
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<div class="login">
		<aside class="login__brand">
			<div class="login__brandinner">
				<div class="brand-mark login__logo"><span class="dot" /> NochOtel</div>
				<p class="login__tagline">Учёт номерного фонда вахтовых гостиниц</p>
				<p class="login__sub">Размещение, свободные места, карта посёлков и кабинет вахтовика — в одной системе.</p>
			</div>
		</aside>

		<main class="login__formside">
			<form class="login__form" @submit.prevent="submit">
				<h1 class="login__title">{{ needsSetup ? "Создание администратора" : "Вход в систему" }}</h1>
				<p class="login__hint">{{ needsSetup ? "Задайте первый учётный аккаунт" : "Введите логин и пароль" }}</p>

				<Field label="Логин">
					<Input v-model="username" :invalid="!!err" />
				</Field>
				<Field label="Пароль">
					<Input v-model="password" type="password" :invalid="!!err" />
				</Field>
				<Field v-if="needsSetup" label="ФИО администратора">
					<Input v-model="fullName" />
				</Field>

				<p v-if="err" class="login__err">{{ err }}</p>
				<Button variant="primary" size="lg" block type="submit" :loading="busy">
					{{ needsSetup ? "Создать и войти" : "Войти" }}
				</Button>
			</form>
		</main>
	</div>
</template>

<style scoped>
.login {
	min-height: 100vh;
	min-height: 100dvh;
	display: grid;
	grid-template-columns: 1.1fr 1fr;
}
.login__brand {
	display: flex;
	align-items: center;
	padding: var(--gap-xl);
	background: var(--brand-gradient-bg), var(--color-raised-bg);
	border-right: 1px solid var(--color-divider);
}
.login__brandinner {
	max-width: 380px;
	margin: 0 auto;
}
.login__logo {
	font-size: 1.8rem;
}
.login__tagline {
	margin: var(--gap-lg) 0 0;
	font-size: var(--font-size-xl);
	font-weight: var(--font-weight-extrabold);
	color: var(--color-contrast);
	line-height: 1.25;
}
.login__sub {
	margin: var(--gap-md) 0 0;
	color: var(--color-secondary);
}
.login__formside {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: var(--gap-xl);
}
.login__form {
	width: 100%;
	max-width: 360px;
}
.login__title {
	font-size: var(--font-size-xl);
}
.login__hint {
	margin: 4px 0 var(--gap-xl);
	color: var(--color-secondary);
}
.login__err {
	color: var(--color-red);
	font-size: var(--font-size-sm);
	margin: var(--gap-md) 0 0;
}
.login__form :deep(.k-btn) {
	margin-top: var(--gap-lg);
}
@media (max-width: 720px) {
	.login {
		grid-template-columns: 1fr;
	}
	.login__brand {
		border-right: none;
		border-bottom: 1px solid var(--color-divider);
		padding: var(--gap-xl) var(--gap-lg);
	}
	.login__tagline {
		font-size: var(--font-size-lg);
	}
	.login__sub {
		display: none;
	}
}
</style>
