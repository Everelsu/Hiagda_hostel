<script setup>
import { dateTime, nightsBetween, nightsWord, today } from "@/utils/date"
import { printCreds } from "@/utils/printCreds"
import { ref, onMounted, computed, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { api, post, put, del, download } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import Modal from "@/components/Modal.vue"
import ImportResidents from "@/components/ImportResidents.vue"
import {
	PageHeader, SegmentedControl, FilterBar, Input, Button, IconButton, DataTable, Drawer, Tabs,
	Field, Textarea, Select, Avatar, Chip, StatusDot, EmptyState, confirm,
} from "@/ui"
import Icon from "@/components/Icon.vue"

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const canEdit = auth.can("editor")
const canAdmin = auth.can("admin")

const view = ref("residents")
const viewOptions = computed(() => [
	{ value: "residents", label: "Вахтовики", icon: "users" },
	...(canAdmin ? [{ value: "staff", label: "Персонал", icon: "user-cog" }] : []),
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
	{ key: "tab_number", label: "Таб. №", sortable: true },
	{ key: "department", label: "Подразделение · должность", sortable: true },
	{ key: "stay_place", label: "Где живёт", sortable: true },
	{ key: "account_username", label: "Кабинет" },
]
const stageLabel = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }

let timer
// Список грузим целиком и фильтруем на месте: сотни и даже тысячи строк
// отбираются мгновенно, без запроса на каждую букву
const fCompany = ref("")
const fDept = ref("")
const fStatus = ref("all")
const showImport = ref(false)
const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е")
const uniq = (key) => [...new Set(residents.value.map((r) => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"))
const companies = computed(() => uniq("company"))
const departments = computed(() => uniq("department"))
const statusOptions = computed(() => [
	{ value: "all", label: "Все", count: residents.value.length },
	{ value: "living", label: "Проживают", count: residents.value.filter((r) => r.stay_place).length },
	{ value: "away", label: "Не живут", count: residents.value.filter((r) => !r.stay_place).length },
	{ value: "noacc", label: "Без кабинета", count: residents.value.filter((r) => !r.account_username).length },
])
const filtered = computed(() => {
	const n = norm(q.value.trim())
	return residents.value.filter(
		(r) =>
			(!n || norm(r.full_name).includes(n) || norm(r.tab_number).includes(n)) &&
			(!fCompany.value || r.company === fCompany.value) &&
			(!fDept.value || r.department === fDept.value) &&
			(fStatus.value === "all" ||
				(fStatus.value === "living" && r.stay_place) ||
				(fStatus.value === "away" && !r.stay_place) ||
				(fStatus.value === "noacc" && !r.account_username)),
	)
})
const filtersOn = computed(() => !!(q.value || fCompany.value || fDept.value || fStatus.value !== "all"))
function resetFilters() {
	q.value = ""
	fCompany.value = ""
	fDept.value = ""
	fStatus.value = "all"
}
function onImported() {
	showImport.value = false
	loadResidents()
}
const stayTo = (v) => new Date(v + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
async function loadResidents() {
	loadingR.value = true
	try {
		residents.value = await api("/residents")
	} finally {
		loadingR.value = false
	}
}

// Несохранённые правки: сравниваем форму со снимком на момент открытия/сохранения
const snap = ref("")
const dirty = computed(() => !!profile.value && JSON.stringify(form.value) !== snap.value)
async function closeProfile() {
	if (dirty.value && !(await confirm({ title: "Закрыть без сохранения?", message: "Изменения в карточке пропадут.", danger: true, confirmLabel: "Не сохранять", cancelLabel: "Вернуться" }))) return
	profile.value = null
}

// Текущее проживание: бронь не отменена и сегодня внутри [заезд, выезд)
const currentStay = computed(() => {
	const t = today()
	return stays.value.find((s) => s.stage !== "cancelled" && s.stage !== "checked_out" && s.date_from <= t && s.date_to > t) || null
})
const dd = (v, year = false) => new Date(`${v}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) })
function daysLeft(s) {
	const n = nightsBetween(today(), s.date_to)
	return `${n} ${nightsWord(n)}`
}
function copyText(t) {
	navigator.clipboard?.writeText(t).then(() => toast.success("Скопировано"))
}

function newResident() {
	profile.value = { id: null, full_name: "" }
	form.value = { full_name: "", tab_number: "", company: "", department: "", position: "", phone: "", note: "" }
	snap.value = JSON.stringify(form.value)
	stays.value = []
	profileTab.value = "data"
}
async function openProfile(r) {
	profile.value = { ...r }
	form.value = { full_name: r.full_name, tab_number: r.tab_number || "", company: r.company || "", department: r.department || "", position: r.position || "", phone: r.phone || "", note: r.note || "" }
	snap.value = JSON.stringify(form.value)
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
		snap.value = JSON.stringify(form.value)
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
// Пароль виден один раз: без копирования или печати закрыть окно — значит выдавать заново
async function closeCreds() {
	if (!creds.value.saved && !(await confirm({ title: "Закрыть без сохранения?", message: "Вы не распечатали и не скопировали пароли. После закрытия их не посмотреть — придётся сбрасывать заново.", danger: true, confirmLabel: "Закрыть", cancelLabel: "Вернуться" }))) return
	creds.value = null
}
function copyCreds() {
	creds.value.saved = true
	const text = creds.value.list.map((c) => `${c.full_name}\tлогин: ${c.username}\tпароль: ${c.password}`).join("\n")
	navigator.clipboard?.writeText(text).then(() => toast.success("Скопировано"))
}
function printAll() {
	creds.value.saved = true
	printCreds(creds.value.list)
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

// ?open=ID — открыть карточку сразу (так ведёт быстрый поиск Ctrl+K)
async function openFromQuery() {
	const id = Number(route.query.open)
	if (!id) return
	view.value = "residents"
	const r = residents.value.find((x) => x.id === id)
	if (r) openProfile(r)
	router.replace({ query: {} })
}
watch(() => route.query.open, openFromQuery)
onMounted(async () => {
	await loadResidents()
	openFromQuery()
	if (canAdmin) loadStaff()
})
const fmt = (d) => dateTime(d, { dateStyle: "medium" })
</script>

<template>
	<div class="grid">
		<PageHeader title="Профили" subtitle="Вахтовики и персонал — в одном месте" icon="users">
			<template #actions>
				<template v-if="view === 'residents'">
					<Button icon="download" @click="download('/export/residents')">Экспорт</Button>
					<Button v-if="canEdit" icon="upload" @click="showImport = true">Импорт из Excel</Button>
					<Button v-if="canAdmin" icon="key" @click="bulkIssue">Доступ всем</Button>
					<Button v-if="canEdit" variant="primary" icon="plus" @click="newResident">Вахтовик</Button>
				</template>
				<Button v-else variant="primary" icon="plus" @click="newStaff">Сотрудник</Button>
			</template>
		</PageHeader>

		<Tabs v-model="view" :options="viewOptions" />

		<!-- Вахтовики -->
		<template v-if="view === 'residents'">
			<div class="filters">
				<div class="filters__search">
					<Icon name="search" class="filters__ic" />
					<Input v-model="q" placeholder="ФИО или табельный №" style="padding-left: 2.2rem" />
				</div>
				<Select v-if="companies.length > 1" v-model="fCompany" style="width: auto; max-width: 14rem">
					<option value="">Все организации</option>
					<option v-for="c in companies" :key="c" :value="c">{{ c }}</option>
				</Select>
				<Select v-if="departments.length > 1" v-model="fDept" style="width: auto; max-width: 20rem">
					<option value="">Все подразделения</option>
					<option v-for="d in departments" :key="d" :value="d">{{ d }}</option>
				</Select>
				<SegmentedControl v-model="fStatus" :options="statusOptions" />
				<Button v-if="filtersOn" variant="ghost" size="sm" icon="x" @click="resetFilters">Сбросить</Button>
			</div>
			<DataTable
				:columns="residentColumns"
				:rows="filtered"
				:loading="loadingR"
				:page-size="50"
				empty-icon="users"
				:empty-title="residents.length ? 'Никого не найдено' : 'Список пуст'"
				:empty-text="residents.length ? 'Измените поиск или фильтры' : 'Добавьте вахтовика вручную или загрузите выгрузку из Excel'"
				@row-click="openProfile"
			>
				<template #cell-full_name="{ row }">
					<div class="row" style="gap: var(--gap-sm)">
						<Avatar :src="row.photo" :name="row.full_name" size="2rem" />
						<b class="contrast">{{ row.full_name }}</b>
					</div>
				</template>
				<template #cell-tab_number="{ value }"><span :class="value ? 'mono' : 'muted'">{{ value || "—" }}</span></template>
				<template #cell-department="{ row }">
					<div class="cell2">
						<span :class="row.department ? '' : 'muted'">{{ row.department || "—" }}</span>
						<span class="muted">{{ [row.position, row.company].filter(Boolean).join(" · ") }}</span>
					</div>
				</template>
				<template #cell-stay_place="{ row }">
					<div v-if="row.stay_place" class="cell2">
						<span class="contrast">{{ row.stay_place }}</span>
						<span class="muted">до {{ stayTo(row.stay_to) }}</span>
					</div>
					<span v-else class="muted">—</span>
				</template>
				<template #cell-account_username="{ row }">
					<Chip v-if="row.account_username" :color="row.account_must_change ? 'var(--color-orange)' : 'var(--color-green)'" dot>{{ row.account_must_change ? "выдан" : "входил" }}</Chip>
					<span v-else class="muted" style="font-size: var(--font-size-xs)">нет</span>
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
		<Drawer v-if="profile" width="640px" @close="closeProfile">
			<template #head>
				<div v-if="profile.id" class="ph">
					<Avatar :src="profile.photo" :name="profile.full_name" size="3.4rem" />
					<div class="ph__text">
						<h3 class="ph__name">{{ profile.full_name }}</h3>
						<div class="ph__sub">{{ [profile.position, profile.department].filter(Boolean).join(" · ") || "Должность не указана" }}</div>
						<div class="ph__chips">
							<span v-if="profile.tab_number" class="ph__tag">таб. {{ profile.tab_number }}</span>
							<span v-if="profile.company" class="ph__tag">{{ profile.company }}</span>
							<Chip v-if="currentStay" color="var(--color-green)" dot>проживает</Chip>
							<Chip v-if="profile.account_username" :color="profile.account_must_change ? 'var(--color-orange)' : 'var(--color-blue)'" dot>
								{{ profile.account_must_change ? "доступ выдан" : "в кабинете" }}
							</Chip>
						</div>
					</div>
				</div>
				<div v-else class="ph">
					<Avatar :name="form.full_name || '+'" size="3.4rem" />
					<div class="ph__text">
						<h3 class="ph__name">{{ form.full_name || "Новый вахтовик" }}</h3>
						<div class="ph__sub">Заполните карточку — доступ в кабинет можно выдать после сохранения</div>
					</div>
				</div>
			</template>

			<!-- Где живёт сейчас: главное, что ищут в карточке -->
			<div v-if="currentStay" class="now">
				<Icon name="bed" size="1.3rem" />
				<div class="grow">
					<div class="now__place">{{ currentStay.hotel_name }} · № {{ currentStay.room_number }} · {{ currentStay.bed_label }}</div>
					<div class="now__dates">{{ dd(currentStay.date_from) }} – {{ dd(currentStay.date_to) }} · ещё {{ daysLeft(currentStay) }}</div>
				</div>
			</div>

			<Tabs
				v-if="profile.id"
				v-model="profileTab"
				:options="[
					{ value: 'data', label: 'Данные', icon: 'user' },
					{ value: 'access', label: 'Доступ', icon: 'key' },
					{ value: 'stays', label: 'Проживания', icon: 'calendar', count: stays.length },
				]"
			/>

			<template v-if="profileTab === 'data' || !profile.id">
				<section class="fs">
					<h4 class="fs__title">Основное</h4>
					<Field label="ФИО"><Input v-model="form.full_name" placeholder="Фамилия Имя Отчество" :disabled="!canEdit" /></Field>
				</section>
				<section class="fs">
					<h4 class="fs__title">Работа</h4>
					<div class="two">
						<Field label="Табельный №"><Input v-model="form.tab_number" inputmode="numeric" :disabled="!canEdit" /></Field>
						<Field label="Организация"><Input v-model="form.company" placeholder="АО «Хиагда»" :disabled="!canEdit" /></Field>
					</div>
					<Field label="Подразделение"><Input v-model="form.department" :disabled="!canEdit" /></Field>
					<Field label="Должность"><Input v-model="form.position" :disabled="!canEdit" /></Field>
				</section>
				<section class="fs">
					<h4 class="fs__title">Контакты и заметки</h4>
					<Field label="Телефон"><Input v-model="form.phone" type="tel" placeholder="+7 …" :disabled="!canEdit" /></Field>
					<Field label="Примечание" hint="Видно только персоналу"><Textarea v-model="form.note" :rows="3" :disabled="!canEdit" /></Field>
				</section>
			</template>

			<template v-else-if="profileTab === 'access'">
				<div v-if="profile.account_username" class="acc">
					<div class="acc__row">
						<div class="acc__icon"><Icon name="key" size="1.2rem" /></div>
						<div class="grow">
							<div class="acc__label">Логин для входа</div>
							<div class="acc__login">{{ profile.account_username }}</div>
						</div>
						<IconButton icon="copy" label="Скопировать логин" @click="copyText(profile.account_username)" />
					</div>
					<div class="acc__state" :class="profile.account_must_change ? 'warn' : 'ok'">
						<Icon :name="profile.account_must_change ? 'clock' : 'check'" />
						{{ profile.account_must_change ? "Вахтовик ещё не входил — выданный пароль не сменён" : "Вахтовик входил и сменил пароль" }}
					</div>
					<div v-if="canAdmin" class="row wrap" style="gap: var(--gap-sm)">
						<Button icon="rotate-cw" @click="issueAccount(true)">Выдать новый пароль</Button>
						<Button variant="danger" icon="log-out" @click="revokeAccount">Закрыть доступ</Button>
					</div>
				</div>
				<EmptyState v-else icon="key" title="Доступа в кабинет нет" text="Выдайте логин и пароль — вахтовик увидит свой номер, соседей, объявления и сможет подавать заявки на ремонт.">
					<Button v-if="canAdmin" variant="primary" icon="key" @click="issueAccount(false)">Выдать доступ</Button>
				</EmptyState>
				<div class="fs__title" style="margin-top: var(--gap-sm)">В кабинете вахтовик видит</div>
				<ul class="acc__what">
					<li><Icon name="bed" /> свой номер, место и даты проживания</li>
					<li><Icon name="users" /> соседей по комнате (телефон — только с их согласия)</li>
					<li><Icon name="megaphone" /> объявления коменданта</li>
					<li><Icon name="wrench" /> заявки на ремонт и их статус</li>
				</ul>
			</template>

			<template v-else-if="profileTab === 'stays'">
				<EmptyState v-if="!stays.length" icon="calendar" title="Проживаний ещё не было" />
				<ol v-else class="tl">
					<li v-for="(s, i) in stays" :key="i" class="tl__item" :class="{ now: s === currentStay, off: s.stage === 'cancelled' }">
						<span class="tl__dot" :style="{ background: s.status_color }" />
						<div class="grow">
							<div class="tl__place">{{ s.hotel_name }} · № {{ s.room_number }} · {{ s.bed_label }}</div>
							<div class="tl__dates">{{ dd(s.date_from, true) }} – {{ dd(s.date_to, true) }} · {{ nightsBetween(s.date_from, s.date_to) }} {{ nightsWord(nightsBetween(s.date_from, s.date_to)) }}</div>
							<div v-if="s.comment" class="tl__comment">{{ s.comment }}</div>
						</div>
						<Chip :color="s.status_color">{{ stageLabel[s.stage] }}</Chip>
					</li>
				</ol>
			</template>

			<template #foot>
				<Button v-if="profile.id && canEdit" variant="danger" icon="trash" @click="removeResident">Удалить</Button>
				<Button v-if="profile.id" icon="download" @click="report(profile)">Excel</Button>
				<span class="grow" />
				<span v-if="dirty" class="dirty"><span class="dirty__dot" /> не сохранено</span>
				<Button variant="ghost" @click="closeProfile">Закрыть</Button>
				<Button v-if="canEdit && (profileTab === 'data' || !profile.id)" variant="primary" icon="check" :loading="busy" :disabled="!dirty" @click="saveProfile">Сохранить</Button>
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

		<ImportResidents v-if="showImport" @close="showImport = false" @done="onImported" />

		<!-- Реквизиты -->
		<Modal v-if="creds" :title="creds.title" persistent @close="closeCreds">
			<p class="creds-hint"><Icon name="alert-triangle" /> Пароль показывается только сейчас. Распечатайте карточки или скопируйте — вахтовик сменит пароль при первом входе.</p>
			<div class="table-scroll">
				<table class="dt">
					<thead><tr><th>Вахтовик</th><th>Логин</th><th>Пароль</th></tr></thead>
					<tbody><tr v-for="c in creds.list" :key="c.username"><td>{{ c.full_name }}</td><td><code>{{ c.username }}</code></td><td><code>{{ c.password }}</code></td></tr></tbody>
				</table>
			</div>
			<template #foot>
				<Button icon="copy" @click="copyCreds">Копировать</Button>
				<Button icon="printer" @click="printAll">Печать карточек</Button>
				<Button variant="primary" @click="closeCreds">Готово</Button>
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
.filters {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--gap-sm);
}
.filters__search {
	position: relative;
	flex: 1;
	min-width: 220px;
	max-width: 360px;
}
.filters__ic {
	position: absolute;
	left: 0.8rem;
	top: 50%;
	transform: translateY(-50%);
	color: var(--color-secondary);
	pointer-events: none;
	z-index: 1;
}
.cell2 {
	display: grid;
	line-height: 1.3;
}
.cell2 .muted {
	font-size: var(--font-size-xs);
}
.mono {
	font-family: var(--font-mono);
	font-size: var(--font-size-xs);
}
/* Карточка вахтовика */
.ph {
	display: flex;
	gap: var(--gap-md);
	align-items: center;
	min-width: 0;
}
.ph__text {
	min-width: 0;
}
.ph__name {
	font-size: var(--font-size-lg);
	line-height: 1.25;
}
.ph__sub {
	font-size: var(--font-size-sm);
	color: var(--color-secondary);
	margin-top: 2px;
}
.ph__chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: var(--gap-sm);
}
.ph__tag {
	display: inline-flex;
	align-items: center;
	height: 1.5rem;
	padding: 0 8px;
	border-radius: var(--radius-max);
	background: var(--color-button-bg);
	color: var(--color-base);
	font-size: var(--font-size-xs);
	font-weight: var(--font-weight-bold);
}
.now {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	padding: var(--gap-md) var(--gap-lg);
	border-radius: var(--radius-md);
	background: var(--color-green-bg);
	color: var(--color-green);
}
.now__place {
	color: var(--color-contrast);
	font-weight: var(--font-weight-bold);
}
.now__dates {
	font-size: var(--font-size-sm);
	color: var(--color-base);
}
.fs {
	display: flex;
	flex-direction: column;
	gap: var(--gap-md);
	padding-bottom: var(--gap-lg);
	border-bottom: 1px solid var(--color-divider);
}
.fs:last-of-type {
	border-bottom: none;
	padding-bottom: 0;
}
.fs__title {
	font-size: var(--font-size-xs);
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--color-secondary);
}
.acc {
	display: flex;
	flex-direction: column;
	gap: var(--gap-md);
	padding: var(--gap-lg);
	border-radius: var(--radius-lg);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
}
.acc__row {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
}
.acc__icon {
	display: grid;
	place-items: center;
	width: 2.6rem;
	height: 2.6rem;
	border-radius: var(--radius-md);
	background: var(--color-brand-highlight);
	color: var(--color-brand);
}
.acc__label {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.acc__login {
	font-family: var(--font-mono);
	font-size: var(--font-size-lg);
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
}
.acc__state {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	font-size: var(--font-size-sm);
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
}
.acc__state.warn {
	background: var(--color-orange-bg);
	color: var(--color-orange);
}
.acc__state.ok {
	background: var(--color-green-bg);
	color: var(--color-green);
}
.acc__what {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	gap: var(--gap-sm);
	font-size: var(--font-size-sm);
	color: var(--color-secondary);
}
.acc__what li {
	display: flex;
	gap: var(--gap-sm);
	align-items: center;
}
.tl {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	gap: 2px;
}
.tl__item {
	display: flex;
	align-items: flex-start;
	gap: var(--gap-md);
	padding: var(--gap-md);
	border-radius: var(--radius-md);
	position: relative;
}
.tl__item:hover {
	background: var(--color-bg);
}
.tl__item.now {
	background: var(--color-green-bg);
}
.tl__item.off {
	opacity: 0.55;
}
.tl__dot {
	width: 10px;
	height: 10px;
	border-radius: 50%;
	margin-top: 6px;
	flex-shrink: 0;
}
.tl__place {
	color: var(--color-contrast);
	font-weight: var(--font-weight-bold);
	font-size: var(--font-size-sm);
}
.tl__dates {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.tl__comment {
	font-size: var(--font-size-xs);
	color: var(--color-base);
	margin-top: 2px;
}
.dirty {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-size: var(--font-size-xs);
	color: var(--color-orange);
	font-weight: var(--font-weight-bold);
}
.dirty__dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: var(--color-orange);
}
.creds-hint {
	display: flex;
	gap: var(--gap-sm);
	align-items: flex-start;
	margin: 0 0 var(--gap-md);
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-orange-bg, var(--color-bg));
	color: var(--color-orange);
	font-size: var(--font-size-sm);
}
.dt code {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
	font-weight: 700;
	color: var(--color-contrast);
	letter-spacing: 0.04em;
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
