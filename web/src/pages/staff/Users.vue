<script setup>
import { ref, onMounted, computed } from "vue"
import { api, post, put, del } from "@/api/client"
import { toast } from "@/toast"

const users = ref([])
const residents = ref([])
const ROLE_LABEL = { admin: "Администратор", editor: "Редактор", viewer: "Просмотр (пользователь)" }
const ROLES = [
	["viewer", "Просмотр — пользователь (вахтовик)"],
	["editor", "Редактор — персонал"],
	["admin", "Администратор"],
]

const form = ref({ username: "", password: "", full_name: "", role: "editor", resident_id: "" })
const isResident = computed(() => form.value.role === "viewer")

async function load() {
	users.value = await api("/users")
}
onMounted(async () => {
	await load()
	residents.value = await api("/residents?q=")
})

async function create() {
	try {
		await post("/users", {
			username: form.value.username,
			password: form.value.password,
			full_name: form.value.full_name,
			role: form.value.role,
			resident_id: form.value.resident_id || null,
		})
		form.value = { username: "", password: "", full_name: "", role: "viewer", resident_id: "" }
		toast("Пользователь создан")
		load()
	} catch (e) {
		toast(e.message)
	}
}
async function remove(u) {
	if (!confirm(`Удалить пользователя ${u.username}?`)) return
	try {
		await del("/users/" + u.id)
		load()
	} catch (e) {
		toast(e.message)
	}
}
async function resetPassword(u) {
	const next = prompt(`Новый пароль для ${u.username}:`)
	if (!next) return
	try {
		await put("/users/" + u.id, { password: next })
		toast("Пароль обновлён")
	} catch (e) {
		toast(e.message)
	}
}
</script>

<template>
	<div class="grid" style="max-width: 820px">
		<h1>Пользователи</h1>

		<div class="card">
			<div class="section-title">Добавить пользователя</div>
			<div class="row wrap">
				<div class="field grow" style="min-width: 160px"><label>Логин</label><input v-model="form.username" /></div>
				<div class="field grow" style="min-width: 160px"><label>Пароль</label><input v-model="form.password" type="text" /></div>
			</div>
			<div class="row wrap">
				<div class="field grow" style="min-width: 160px"><label>ФИО</label><input v-model="form.full_name" /></div>
				<div class="field grow" style="min-width: 160px">
					<label>Роль</label>
					<select v-model="form.role">
						<option v-for="r in ROLES" :key="r[0]" :value="r[0]">{{ r[1] }}</option>
					</select>
				</div>
			</div>
			<div v-if="isResident" class="field">
				<label>Проживающий (чей профиль увидит пользователь)</label>
				<select v-model="form.resident_id">
					<option value="">— выберите —</option>
					<option v-for="r in residents" :key="r.id" :value="r.id">
						{{ r.full_name }}<template v-if="r.tab_number"> · {{ r.tab_number }}</template>
					</option>
				</select>
				<p class="muted" style="font-size: var(--font-size-xs); margin-top: 4px">
					Пользователь войдёт под этим логином и увидит своё размещение, соседей, удобства и сможет оставить отзыв.
				</p>
			</div>
			<button class="btn btn-primary" @click="create">Создать</button>
		</div>

		<div class="card">
			<div class="section-title">Все пользователи <span class="muted" style="font-weight: 400">({{ users.length }})</span></div>
			<div class="grid" style="gap: var(--gap-sm)">
				<div v-for="u in users" :key="u.id" class="urow">
					<div class="grow">
						<div class="contrast" style="font-weight: 700">{{ u.full_name || u.username }} <span class="muted" style="font-weight: 400">@{{ u.username }}</span></div>
						<div class="muted" style="font-size: var(--font-size-sm)">
							{{ ROLE_LABEL[u.role] }}<template v-if="u.resident_name"> · профиль: {{ u.resident_name }}</template>
						</div>
					</div>
					<button class="btn btn-sm" @click="resetPassword(u)">Пароль</button>
					<button class="btn btn-sm btn-danger" @click="remove(u)">Удалить</button>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.urow {
	display: flex;
	gap: var(--gap-sm);
	align-items: center;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
</style>
