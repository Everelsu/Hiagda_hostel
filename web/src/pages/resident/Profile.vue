<script setup>
import { ref, onMounted } from "vue"
import { api, put, post } from "@/api/client"
import { toast } from "@/toast"

const resident = ref(null)
const about = ref("")
const phone = ref("")
const photo = ref("")
const curPass = ref("")
const newPass = ref("")

onMounted(async () => {
	const data = await api("/me/overview")
	resident.value = data.resident
	about.value = data.resident?.about || ""
	phone.value = data.resident?.phone || ""
	photo.value = data.resident?.photo || ""
})

async function saveProfile() {
	try {
		await put("/me/profile", { about: about.value, phone: phone.value, photo: photo.value })
		toast("Профиль сохранён")
	} catch (e) {
		toast(e.message)
	}
}
async function changePassword() {
	if (!newPass.value) return
	try {
		await post("/me/password", { current: curPass.value, next: newPass.value })
		curPass.value = newPass.value = ""
		toast("Пароль изменён")
	} catch (e) {
		toast(e.message)
	}
}
</script>

<template>
	<div class="grid" style="max-width: 560px">
		<h1>Мой профиль</h1>

		<div class="card">
			<div class="section-title">О себе</div>
			<div class="field"><label>ФИО</label><input :value="resident?.full_name" disabled /></div>
			<div class="row" style="gap: var(--gap-md)">
				<div class="field grow"><label>Табельный №</label><input :value="resident?.tab_number || '—'" disabled /></div>
				<div class="field grow"><label>Организация</label><input :value="resident?.company || '—'" disabled /></div>
			</div>
			<div class="field"><label>Телефон</label><input v-model="phone" placeholder="+7 …" /></div>
			<div class="field"><label>Ссылка на фото (URL)</label><input v-model="photo" placeholder="https://…" /></div>
			<div class="field"><label>О себе</label><textarea v-model="about" rows="3" placeholder="Пара слов о себе" /></div>
			<button class="btn btn-primary" @click="saveProfile">Сохранить</button>
		</div>

		<div class="card">
			<div class="section-title">Смена пароля</div>
			<div class="field"><label>Текущий пароль</label><input v-model="curPass" type="password" /></div>
			<div class="field"><label>Новый пароль</label><input v-model="newPass" type="password" /></div>
			<button class="btn" @click="changePassword">Изменить пароль</button>
		</div>
	</div>
</template>
