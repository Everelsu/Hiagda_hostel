<script setup>
import { ref, onMounted } from "vue"
import { api, post, put, del } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import Modal from "@/components/Modal.vue"

const auth = useAuthStore()
const canEdit = auth.can("editor")
const q = ref("")
const list = ref([])
const edit = ref(null)
const card = ref(null)

let timer
function onSearch() {
	clearTimeout(timer)
	timer = setTimeout(load, 250)
}
async function load() {
	list.value = await api("/residents?q=" + encodeURIComponent(q.value))
}
onMounted(load)

function add() {
	edit.value = { full_name: "", tab_number: "", company: "", position: "", phone: "", note: "" }
}
function openEdit(r) {
	edit.value = { ...r }
}
async function save() {
	const m = edit.value
	if (!m.full_name) return toast("Укажите ФИО")
	try {
		if (m.id) await put("/residents/" + m.id, m)
		else await post("/residents", m)
		edit.value = null
		load()
		toast("Сохранено")
	} catch (e) {
		toast(e.message)
	}
}
async function remove(r) {
	if (!confirm(`Удалить проживающего «${r.full_name}»?`)) return
	await del("/residents/" + r.id)
	load()
}
async function openCard(r) {
	card.value = await api(`/residents/${r.id}/card`)
}
function report(r) {
	window.open("/api/report/resident/" + r.id, "_blank")
}
const stageLabel = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }
</script>

<template>
	<div class="grid" style="max-width: 820px">
		<div class="spread"><h1>Проживающие</h1><button v-if="canEdit" class="btn btn-primary btn-sm" @click="add">+ Добавить</button></div>

		<input v-model="q" placeholder="Поиск по ФИО / табельному №" @input="onSearch" />

		<div class="grid" style="gap: var(--gap-sm)">
			<p v-if="!list.length" class="muted">Никого не найдено.</p>
			<div v-for="r in list" :key="r.id" class="li">
				<div class="avatar">{{ r.full_name.charAt(0) }}</div>
				<button class="grow link" @click="openCard(r)">
					<div class="contrast" style="font-weight: 700">{{ r.full_name }}</div>
					<div class="muted" style="font-size: var(--font-size-sm)">{{ [r.company, r.position, r.tab_number].filter(Boolean).join(" · ") || "—" }}</div>
				</button>
				<button class="btn btn-sm" @click="report(r)">⭳</button>
				<button v-if="canEdit" class="btn btn-sm" @click="openEdit(r)">✎</button>
				<button v-if="canEdit" class="btn btn-sm btn-danger" @click="remove(r)">✕</button>
			</div>
		</div>

		<Modal v-if="edit" :title="edit.id ? 'Проживающий' : 'Новый проживающий'" @close="edit = null">
			<div class="field"><label>ФИО</label><input v-model="edit.full_name" /></div>
			<div class="row wrap">
				<div class="field grow"><label>Табельный №</label><input v-model="edit.tab_number" /></div>
				<div class="field grow"><label>Организация</label><input v-model="edit.company" /></div>
			</div>
			<div class="row wrap">
				<div class="field grow"><label>Должность</label><input v-model="edit.position" /></div>
				<div class="field grow"><label>Телефон</label><input v-model="edit.phone" /></div>
			</div>
			<div class="field"><label>Примечание</label><textarea v-model="edit.note" rows="2" /></div>
			<template #foot>
				<button class="btn" @click="edit = null">Отмена</button>
				<button class="btn btn-primary" @click="save">Сохранить</button>
			</template>
		</Modal>

		<Modal v-if="card" :title="card.resident.full_name" wide @close="card = null">
			<div class="muted">
				{{ [card.resident.tab_number && "Таб. № " + card.resident.tab_number, card.resident.company, card.resident.position, card.resident.phone].filter(Boolean).join(" · ") || "Доп. данных нет" }}
			</div>
			<div class="section-title" style="font-size: var(--font-size-nm); margin-top: var(--gap-md)">История проживаний ({{ card.stays.length }})</div>
			<p v-if="!card.stays.length" class="muted">Размещений нет.</p>
			<div v-else class="table-scroll">
				<table class="dt">
					<thead><tr><th>Гостиница</th><th>Номер</th><th>Место</th><th>Заезд</th><th>Выезд</th><th>Статус</th><th>Стадия</th></tr></thead>
					<tbody>
						<tr v-for="(s, i) in card.stays" :key="i">
							<td>{{ s.hotel_name }}</td><td>{{ s.room_number }}</td><td>{{ s.bed_label }}</td><td>{{ s.date_from }}</td><td>{{ s.date_to }}</td>
							<td><span class="dot" :style="{ background: s.status_color }" /> {{ s.status_name }}</td>
							<td>{{ stageLabel[s.stage] }}</td>
						</tr>
					</tbody>
				</table>
			</div>
			<template #foot>
				<button class="btn" @click="report(card.resident)">⭳ Excel</button>
				<button class="btn btn-primary" @click="card = null">Закрыть</button>
			</template>
		</Modal>
	</div>
</template>

<style scoped>
.li {
	display: flex;
	gap: var(--gap-sm);
	align-items: center;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.avatar {
	width: 2.2rem;
	height: 2.2rem;
	border-radius: var(--radius-max);
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	display: grid;
	place-items: center;
	font-weight: 800;
	flex-shrink: 0;
}
.link {
	text-align: left;
	background: transparent;
	border: none;
	cursor: pointer;
	padding: 0;
}
.table-scroll {
	overflow-x: auto;
}
.dt {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--font-size-sm);
}
.dt th,
.dt td {
	text-align: left;
	padding: var(--gap-xs) var(--gap-sm);
	border-bottom: 1px solid var(--color-divider);
	white-space: nowrap;
}
.dt .dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: var(--radius-max);
	margin-right: 4px;
}
</style>
