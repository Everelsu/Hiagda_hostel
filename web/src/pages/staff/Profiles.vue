<script setup>
import { ref, onMounted, computed } from "vue"
import { api, post, put, del, download } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import Modal from "@/components/Modal.vue"
import {
	PageHeader, SegmentedControl, FilterBar, Input, Button, IconButton, DataTable, Drawer, Tabs,
	Field, Textarea, Select, Avatar, Chip, StatusDot, EmptyState, confirm,
} from "@/ui"

const auth = useAuthStore()
const canEdit = auth.can("editor")
const canAdmin = auth.can("admin")

const view = ref("residents")
const viewOptions = computed(() => [
	{ value: "residents", label: "Вахтовики" },
	...(canAdmin ? [{ value: "staff", label: "Персонал" }] : []),
])

/* ---------- Вахтовики ---------- */
const q = ref("")
const residents = ref([])
const loadingR = ref(true)
const profile = ref(null)
const profileTab = ref("data")
const form = ref({})
const stays = ref([])
const busy = ref(false)
const creds = ref(null)

const residentColumns = [
	{ key: "full_name", label: "ФИО", sortable: true },
	{ key: "tab_number", label: "Табельный №", sortable: true },
	{ key: "company", label: "Организация", sortable: true },
	{ key: "position", label: "Должность" },
	{ key: "account_username", label: "Доступ" },
]
const stayColumns = [
	{ key: "hotel_name", label: "Гостиница" },
	{ key: "room_number", label: "Номер" },
	{ key: "bed_label", label: "Место" },
	{ key: "date_from", label: "Заезд" },
	{ key: "date_to", label: "Выезд" },
	{ key: "stage", label: "Стадия" },
]
const stageLabel = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }

let timer
function onSearch() {
	clearTimeout(timer)
	timer = setTimeout(loadResidents, 250)
}
async function loadResidents() {
	loadingR.value = true
	try {
		residents.value = await api("/residents?q=" + encodeURIComponent(q.value))
	} finally {
		loadingR.value = false
	}
}

function newResident() {
	profile.value = { id: null, full_name: "" }
	form.value = { full_name: "", tab_number: "", company: "", position: "", phone: "", note: "" }
	stays.value = []
	profileTab.value = "data"
}
async function openProfile(r) {
	profile.value = { ...r }
	form.value = { full_name: r.full_name, tab_number: r.tab_number || "", company: r.company || "", position: r.position || "", phone: r.phone || "", note: r.note || "" }
	profileTab.value = "data"
	stays.value = []
	try {
		const card = await api(`/residents/${r.id}/card`)
		stays.value = card.stays
	} catch {}
}
async function saveProfile() {
	if (!form.value.full_name.trim()) return toast.error("Укажите ФИО")
	busy.value = true
	try {
		if (profile.value.id) await put("/residents/" + profile.value.id, form.value)
		else {
			const r = await post("/residents", form.value)
			profile.value.id = r.id
		}
		toast.success("Сохранено")
		await loadResidents()
		const fresh = residents.value.find((x) => x.id === profile.value.id)
		if (fresh) profile.value = { ...fresh }
	} catch (e) {
		toast.error(e.message)
	} finally {
		busy.value = false
	}
}
async function removeResident() {
	if (!(await confirm({ title: `Удалить «${profile.value.full_name}»?`, message: "Профиль и размещения будут удалены.", danger: true, confirmLabel: "Удалить" }))) return
	await del("/residents/" + profile.value.id)
	profile.value = null
	toast.success("Удалено")
	loadResidents()
}
function report(r) {
	download("/report/resident/" + r.id)
}
async function refreshProfileRow() {
	await loadResidents()
	const fresh = residents.value.find((x) => x.id === profile.value.id)
	if (fresh) profile.value = { ...profile.value, ...fresh }
}
async function issueAccount(reset = false) {
	if (reset && !(await confirm({ title: "Сбросить пароль?", message: "Старый пароль перестанет работать.", confirmLabel: "Сбросить" }))) return
	try {
		const c = await post(`/residents/${profile.value.id}/account`, {})
		creds.value = { title: reset ? "Новый пароль выдан" : "Доступ выдан", list: [c] }
		await refreshProfileRow()
	} catch (e) {
		toast.error(e.message)
	}
}
async function revokeAccount() {
	if (!(await confirm({ title: "Убрать доступ?", message: "Учётная запись будет удалена.", danger: true, confirmLabel: "Убрать доступ" }))) return
	await del(`/residents/${profile.value.id}/account`)
	await refreshProfileRow()
	toast.success("Доступ убран")
}
async function bulkIssue() {
	if (!(await confirm({ title: "Выдать доступ всем?", message: "Аккаунты создадутся всем без учётной записи." }))) return
	try {
		const r = await post("/residents/accounts/bulk", {})
		if (!r.issued.length) return toast("Все уже с доступом")
		creds.value = { title: `Выдано доступов: ${r.issued.length}`, list: r.issued }
		loadResidents()
	} catch (e) {
		toast.error(e.message)
	}
}
function copyCreds() {
	const text = creds.value.list.map((c) => `${c.full_name}\tлогин: ${c.username}\tпароль: ${c.password}`).join("\n")
	navigator.clipboard?.writeText(text).then(() => toast.success("Скопировано"))
}
function printCreds() {
	const rows = creds.value.list
		.map((c) => `<div class="slip"><div class="n">${c.full_name}</div><div>Логин: <b>${c.username}</b></div><div>Пароль: <b>${c.password}</b></div><div class="hint">Смените пароль при первом входе.</div></div>`)
		.join("")
	const w = window.open("", "_blank")
	w.document.write(`<html><head><title>Реквизиты доступа</title><style>body{font-family:sans-serif;padding:20px}.slip{border:1px dashed #888;border-radius:8px;padding:14px 18px;margin:0 0 12px;max-width:360px}.n{font-weight:700;font-size:18px;margin-bottom:6px}.hint{color:#888;font-size:12px;margin-top:6px}b{font-size:16px}@media print{.slip{page-break-inside:avoid}}</style></head><body><h2>Реквизиты доступа · Хиагда</h2>${rows}<script>window.print()<\/script></body></html>`)
	w.document.close()
}

/* ---------- Персонал ---------- */
const staff = ref([])
const loadingS = ref(false)
const staffDrawer = ref(null)
const ROLE_LABEL = { admin: "Администратор", editor: "Редактор", observer: "Просмотр", maintenance: "Ремонтная служба" }
const ROLE_COLOR = { admin: "var(--color-brand)", editor: "var(--color-blue)", observer: "var(--color-gray)", maintenance: "var(--color-orange)" }
const staffColumns = [
	{ key: "full_name", label: "Сотрудник", sortable: true },
	{ key: "role", label: "Роль", sortable: true },
	{ key: "created_at", label: "Создан", sortable: true },
]
async function loadStaff() {
	loadingS.value = true
	try {
		staff.value = (await api("/users")).filter((u) => u.role !== "viewer")
	} finally {
		loadingS.value = false
	}
}
function newStaff() {
	staffDrawer.value = { id: null, username: "", password: "", full_name: "", role: "editor" }
}
function editStaff(u) {
	staffDrawer.value = { ...u, password: "" }
}
async function saveStaff() {
	const s = staffDrawer.value
	busy.value = true
	try {
		if (s.id) await put("/users/" + s.id, { full_name: s.full_name, role: s.role, ...(s.password ? { password: s.password } : {}) })
		else await post("/users", { username: s.username, password: s.password, full_name: s.full_name, role: s.role })
		staffDrawer.value = null
		toast.success("Сохранено")
		loadStaff()
	} catch (e) {
		toast.error(e.message)
	} finally {
		busy.value = false
	}
}
async function removeStaff(u) {
	if (!(await confirm({ title: `Удалить ${u.username}?`, danger: true, confirmLabel: "Удалить" }))) return
	try {
		await del("/users/" + u.id)
		toast.success("Удалено")
		loadStaff()
	} catch (e) {
		toast.error(e.message)
	}
}

onMounted(async () => {
	await loadResidents()
	if (canAdmin) loadStaff()
})
function fmt(d) {
	return d ? new Date(d.replace(" ", "T") + "Z").toLocaleDateString("ru-RU", { dateStyle: "medium" }) : ""
}
</script>

<template>
	<div class="grid">
		<PageHeader title="Профили" subtitle="Вахтовики и персонал — в одном месте" icon="users">
			<template #actions>
				<template v-if="view === 'residents'">
					<Button v-if="canAdmin" icon="key" @click="bulkIssue">Доступ всем</Button>
					<Button v-if="canEdit" variant="primary" icon="plus" @click="newResident">Вахтовик</Button>
				</template>
				<Button v-else variant="primary" icon="plus" @click="newStaff">Сотрудник</Button>
			</template>
		</PageHeader>

		<SegmentedControl v-model="view" :options="viewOptions" />

		<!-- Вахтовики -->
		<template v-if="view === 'residents'">
			<FilterBar>
				<Input v-model="q" placeholder="Поиск по ФИО / табельному №" @input="onSearch" style="min-width: 280px" />
			</FilterBar>
			<DataTable :columns="residentColumns" :rows="residents" :loading="loadingR" @row-click="openProfile" empty-title="Никого не найдено" empty-icon="users">
				<template #cell-full_name="{ row }">
					<div class="row" style="gap: var(--gap-sm)">
						<Avatar :src="row.photo" :name="row.full_name" size="2rem" />
						<b class="contrast">{{ row.full_name }}</b>
					</div>
				</template>
				<template #cell-tab_number="{ value }"><span :class="value ? '' : 'muted'">{{ value || "—" }}</span></template>
				<template #cell-company="{ value }"><span :class="value ? '' : 'muted'">{{ value || "—" }}</span></template>
				<template #cell-position="{ value }"><span :class="value ? '' : 'muted'">{{ value || "—" }}</span></template>
				<template #cell-account_username="{ row }">
					<Chip v-if="row.account_username" color="var(--color-green)" dot>{{ row.account_username }}<template v-if="row.account_must_change"> · не сменён</template></Chip>
					<span v-else class="muted" style="font-size: var(--font-size-xs)">нет доступа</span>
				</template>
				<template #actions="{ row }">
					<IconButton icon="download" label="Отчёт" size="sm" @click="report(row)" />
				</template>
			</DataTable>
		</template>

		<!-- Персонал -->
		<template v-else>
			<DataTable :columns="staffColumns" :rows="staff" :loading="loadingS" @row-click="editStaff" empty-title="Сотрудников нет" empty-icon="user-cog">
				<template #cell-full_name="{ row }">
					<div class="row" style="gap: var(--gap-sm)">
						<Avatar :name="row.full_name || row.username" size="2rem" />
						<div>
							<b class="contrast">{{ row.full_name || row.username }}</b>
							<div class="muted" style="font-size: var(--font-size-xs)">@{{ row.username }}</div>
						</div>
					</div>
				</template>
				<template #cell-role="{ value }"><Chip :color="ROLE_COLOR[value] || 'var(--color-blue)'" dot>{{ ROLE_LABEL[value] || value }}</Chip></template>
				<template #cell-created_at="{ value }"><span class="muted">{{ fmt(value) }}</span></template>
				<template #actions="{ row }">
					<IconButton icon="trash" label="Удалить" size="sm" variant="danger" @click="removeStaff(row)" />
				</template>
			</DataTable>
		</template>

		<!-- Профиль вахтовика -->
		<Drawer v-if="profile" :title="profile.id ? profile.full_name : 'Новый вахтовик'" width="620px" @close="profile = null">
			<Tabs v-if="profile.id" v-model="profileTab" :options="[{ value: 'data', label: 'Данные' }, { value: 'access', label: 'Доступ' }, { value: 'stays', label: 'Проживания', count: stays.length }]" style="margin-bottom: var(--gap-lg)" />

			<template v-if="profileTab === 'data' || !profile.id">
				<Field label="ФИО"><Input v-model="form.full_name" /></Field>
				<div class="two">
					<Field label="Табельный №"><Input v-model="form.tab_number" /></Field>
					<Field label="Организация"><Input v-model="form.company" /></Field>
				</div>
				<div class="two">
					<Field label="Должность"><Input v-model="form.position" /></Field>
					<Field label="Телефон"><Input v-model="form.phone" /></Field>
				</div>
				<Field label="Примечание"><Textarea v-model="form.note" :rows="2" /></Field>
			</template>

			<template v-else-if="profileTab === 'access'">
				<div v-if="profile.account_username" class="access-box">
					<div class="spread">
						<div>
							<div class="muted" style="font-size: var(--font-size-xs)">Логин вахтовика</div>
							<b class="contrast" style="font-size: var(--font-size-lg)">{{ profile.account_username }}</b>
						</div>
						<Chip v-if="profile.account_must_change" color="var(--color-orange)" dot>пароль не сменён</Chip>
						<Chip v-else color="var(--color-green)" dot>активен</Chip>
					</div>
					<div class="row wrap" style="margin-top: var(--gap-md)">
						<Button icon="rotate-cw" @click="issueAccount(true)">Сбросить пароль</Button>
						<Button variant="danger" icon="log-out" @click="revokeAccount">Убрать доступ</Button>
					</div>
				</div>
				<EmptyState v-else icon="key" title="Доступа нет" text="Вахтовик не сможет войти в свой кабинет, пока вы не выдадите доступ.">
					<Button variant="primary" icon="key" @click="issueAccount(false)">Выдать доступ</Button>
				</EmptyState>
			</template>

			<template v-else-if="profileTab === 'stays'">
				<DataTable :columns="stayColumns" :rows="stays" row-key="date_from" empty-title="Размещений нет">
					<template #cell-stage="{ row }"><StatusDot :color="row.status_color" /> {{ stageLabel[row.stage] }}</template>
				</DataTable>
			</template>

			<template #foot>
				<Button v-if="profile.id && canEdit" variant="danger" icon="trash" @click="removeResident">Удалить</Button>
				<Button v-if="profile.id" icon="download" @click="report(profile)">Excel</Button>
				<span style="flex: 1" />
				<Button variant="ghost" @click="profile = null">Закрыть</Button>
				<Button v-if="profileTab === 'data' || !profile.id" variant="primary" :loading="busy" @click="saveProfile">Сохранить</Button>
			</template>
		</Drawer>

		<!-- Сотрудник -->
		<Drawer v-if="staffDrawer" :title="staffDrawer.id ? staffDrawer.full_name || staffDrawer.username : 'Новый сотрудник'" @close="staffDrawer = null">
			<Field v-if="!staffDrawer.id" label="Логин"><Input v-model="staffDrawer.username" /></Field>
			<Field label="ФИО"><Input v-model="staffDrawer.full_name" /></Field>
			<Field label="Роль">
				<Select v-model="staffDrawer.role">
						<option value="observer">Просмотр — только чтение</option>
						<option value="maintenance">Ремонтная служба — заявки и ремонт номеров</option>
						<option value="editor">Редактор — номерной фонд и брони</option>
						<option value="admin">Администратор — полный доступ</option>
					</Select>
			</Field>
			<Field :label="staffDrawer.id ? 'Новый пароль (оставьте пустым, чтобы не менять)' : 'Пароль'" hint="Минимум 6 символов"><Input v-model="staffDrawer.password" /></Field>
			<template #foot>
				<Button variant="ghost" @click="staffDrawer = null">Отмена</Button>
				<Button variant="primary" :loading="busy" @click="saveStaff">Сохранить</Button>
			</template>
		</Drawer>

		<!-- Реквизиты -->
		<Modal v-if="creds" :title="creds.title" @close="creds = null">
			<p class="muted" style="margin: 0">Запишите или распечатайте — пароль показывается один раз. Пользователь сменит его при первом входе.</p>
			<div class="table-scroll">
				<table class="dt">
					<thead><tr><th>Вахтовик</th><th>Логин</th><th>Пароль</th></tr></thead>
					<tbody><tr v-for="c in creds.list" :key="c.username"><td>{{ c.full_name }}</td><td><b>{{ c.username }}</b></td><td><b>{{ c.password }}</b></td></tr></tbody>
				</table>
			</div>
			<template #foot>
				<Button icon="book" @click="copyCreds">Копировать</Button>
				<Button icon="book" @click="printCreds">Печать</Button>
				<Button variant="primary" @click="creds = null">Готово</Button>
			</template>
		</Modal>
	</div>
</template>

<style scoped>
.two {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-md);
}
.access-box {
	padding: var(--gap-lg);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
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
</style>
