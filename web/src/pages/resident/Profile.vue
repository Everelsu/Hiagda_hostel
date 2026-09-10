<script setup>
import { ref, onMounted } from "vue"
import { api, put, post, uploadFile } from "@/api/client"
import { toast } from "@/toast"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, Field, Input, Textarea, Button, Switch, Avatar } from "@/ui"

const resident = ref(null)
const about = ref("")
const phone = ref("")
const photo = ref("")
const showContacts = ref(false)
const curPass = ref("")
const newPass = ref("")
const uploading = ref(false)
const savingProfile = ref(false)
const savingPass = ref(false)

onMounted(async () => {
	const data = await api("/me/overview")
	resident.value = data.resident
	about.value = data.resident?.about || ""
	phone.value = data.resident?.phone || ""
	photo.value = data.resident?.photo || ""
	showContacts.value = !!data.resident?.show_contacts
})

async function onFile(e) {
	const file = e.target.files?.[0]
	if (!file) return
	uploading.value = true
	try {
		photo.value = await uploadFile(file)
		toast.success("Фото загружено — не забудьте сохранить")
	} catch (err) {
		toast.error(err.message)
	} finally {
		uploading.value = false
	}
}
async function saveProfile() {
	savingProfile.value = true
	try {
		await put("/me/profile", { about: about.value, phone: phone.value, photo: photo.value, show_contacts: showContacts.value })
		toast.success("Профиль сохранён")
	} catch (e) {
		toast.error(e.message)
	} finally {
		savingProfile.value = false
	}
}
async function changePassword() {
	if (!newPass.value) return
	savingPass.value = true
	try {
		await post("/me/password", { current: curPass.value, next: newPass.value })
		curPass.value = newPass.value = ""
		toast.success("Пароль изменён")
	} catch (e) {
		toast.error(e.message)
	} finally {
		savingPass.value = false
	}
}
</script>

<template>
	<div class="grid" style="max-width: 560px">
		<PageHeader title="Мой профиль" icon="user" />

		<Card title="О себе" stack>
			<div class="avatar-row">
				<Avatar :src="photo" :name="resident?.full_name" size="4rem" />
				<div class="row" style="gap: var(--gap-sm)">
					<label class="btn btn-sm" style="cursor: pointer"><Icon name="camera" /> {{ uploading ? "Загрузка…" : "Загрузить фото" }}<input type="file" accept="image/*" hidden @change="onFile" /></label>
					<Button v-if="photo" size="sm" variant="danger" @click="photo = ''">Убрать</Button>
				</div>
			</div>
			<Field label="ФИО"><Input :model-value="resident?.full_name" disabled /></Field>
			<div class="two">
				<Field label="Табельный №"><Input :model-value="resident?.tab_number || '—'" disabled /></Field>
				<Field label="Организация"><Input :model-value="resident?.company || '—'" disabled /></Field>
				<Field label="Подразделение"><Input :model-value="resident?.department || '—'" disabled /></Field>
			</div>
			<Field label="Телефон"><Input v-model="phone" placeholder="+7 …" /></Field>
			<div class="privacy">
				<Switch v-model="showContacts" label="Показывать телефон соседям" hint="Соседи всегда видят имя и «о себе». Телефон — только если включено." />
			</div>
			<Field label="О себе"><Textarea v-model="about" :rows="3" placeholder="Пара слов о себе" /></Field>
			<Button variant="primary" :loading="savingProfile" @click="saveProfile">Сохранить</Button>
		</Card>

		<Card title="Смена пароля" stack>
			<Field label="Текущий пароль"><Input v-model="curPass" type="password" /></Field>
			<Field label="Новый пароль"><Input v-model="newPass" type="password" /></Field>
			<Button :loading="savingPass" @click="changePassword">Изменить пароль</Button>
		</Card>
	</div>
</template>

<style scoped>
.avatar-row {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
}
.two {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-md);
}
.privacy {
	padding: var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.k-card + .k-card {
	margin-top: var(--gap-lg);
}
</style>
