<script setup>
import { ref, onMounted } from "vue"
import { useRouter, useRoute } from "vue-router"
import { api, post } from "@/api/client"
import { useAuthStore } from "@/stores/auth"

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
			const r = await post("/register-admin", {
				username: username.value,
				password: password.value,
				full_name: fullName.value,
			})
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
	<div class="login-screen">
		<form class="card login-card" @submit.prevent="submit">
			<div class="brand-mark" style="font-size: 1.6rem"><span class="dot" /> NochOtel</div>
			<p class="muted" style="margin-top: 4px">
				{{ needsSetup ? "Создание администратора" : "Учёт номерного фонда вахтовых гостиниц" }}
			</p>

			<div class="field">
				<label>Логин</label>
				<input v-model="username" autocomplete="username" />
			</div>
			<div class="field">
				<label>Пароль</label>
				<input v-model="password" type="password" autocomplete="current-password" />
			</div>
			<div v-if="needsSetup" class="field">
				<label>ФИО администратора</label>
				<input v-model="fullName" />
			</div>

			<p v-if="err" class="err">{{ err }}</p>
			<button class="btn btn-primary btn-block btn-lg" type="submit" :disabled="busy">
				{{ needsSetup ? "Создать и войти" : "Войти" }}
			</button>
		</form>
	</div>
</template>

<style scoped>
.login-screen {
	min-height: 100vh;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 20px;
	background: var(--brand-gradient-bg), var(--color-bg);
}
.login-card {
	width: 100%;
	max-width: 380px;
}
.err {
	color: var(--color-red);
	font-size: var(--font-size-sm);
	margin: 0 0 var(--gap-md);
}
</style>
