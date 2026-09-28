<script setup>
import { ref, computed, onMounted } from "vue"
import { api, put, post, uploadFile } from "@/api/client"
import { toast } from "@/toast"
import Icon from "@/components/Icon.vue"
import { useRouter } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import { theme, setTheme } from "@/utils/theme"
import { PageHeader, Card, Field, Input, Textarea, Button, Switch, Avatar, SegmentedControl, confirm } from "@/ui"

const router = useRouter()
const auth = useAuthStore()
const THEMES = [
	{ value: "light", label: "Светлая" },
	{ value: "dark", label: "Тёмная" },
]
async function logout() {
	if (!(await confirm({ title: "Выйти из кабинета?", message: "Чтобы войти снова, понадобятся логин и пароль.", confirmLabel: "Выйти" }))) return
	auth.logout()
	router.push({ name: "login" })
}

const resident = ref(null)
const hotel = ref(null)
const stays = ref([])
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
	const [data, list] = await Promise.all([api("/me/overview"), api("/me/stays").catch(() => [])])
	resident.value = data.resident
	hotel.value = data.hotel
	stays.value = list
	about.value = data.resident?.about || ""
	phone.value = data.resident?.phone || ""
	photo.value = data.resident?.photo || ""
	showContacts.value = !!data.resident?.show_contacts
})

/* ---------- мои вахты: где и сколько жил ---------- */
const today = new Date().toISOString().slice(0, 10)
const nights = (p) => Math.max(0, Math.round((new Date(p.date_to) - new Date(p.date_from)) / 864e5))
const stayState = (p) => (p.date_from > today ? "впереди" : p.date_to < today ? "" : "сейчас")
const totals = computed(() => ({ count: stays.value.length, nights: stays.value.reduce((a, p) => a + nights(p), 0) }))
const d = (x) => new Date(x + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" })
const tel = (p) => "tel:" + String(p).replace(/[^d+]/g, "")

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
	<div class="prof">
		<PageHeader title="Профиль" icon="user" />

		<!-- Шапка: фото и кто я -->
		<section class="me k-rise">
			<label class="me__photo" :class="{ busy: uploading }" title="Сменить фото">
				<Avatar :src="photo" :name="resident?.full_name" size="5rem" />
				<span class="me__cam"><Icon :name="uploading ? 'rotate-cw' : 'camera'" size="0.9rem" /></span>
				<input type="file" accept="image/*" hidden @change="onFile" />
			</label>
			<div class="me__text">
				<h2>{{ resident?.full_name || "…" }}</h2>
				<p>{{ [resident?.position, resident?.department].filter(Boolean).join(" · ") || "Должность не указана" }}</p>
				<div class="me__tags">
					<span v-if="resident?.tab_number">таб. {{ resident.tab_number }}</span>
					<span v-if="resident?.company">{{ resident.company }}</span>
				</div>
				<button v-if="photo" type="button" class="me__rm" @click="photo = ''">убрать фото</button>
			</div>
		</section>

		<Card title="Мои вахты" subtitle="Где и когда вы жили" stack class="k-rise" style="--i: 1">
			<div v-if="stays.length" class="totals">
				<div><b>{{ totals.count }}</b><span>{{ totals.count === 1 ? "вахта" : totals.count < 5 ? "вахты" : "вахт" }}</span></div>
				<div><b>{{ totals.nights }}</b><span>ночей всего</span></div>
			</div>
			<p v-else class="muted" style="margin: 0">Пока ни одной вахты — после заселения здесь появится история.</p>
			<ol v-if="stays.length" class="stays">
				<li v-for="p in stays" :key="p.id" :class="{ now: stayState(p) === 'сейчас' }">
					<span class="stays__dot" />
					<div class="grow">
						<b>{{ p.hotel_name }}, № {{ p.room_number }}</b>
						<span class="muted">{{ d(p.date_from) }} — {{ d(p.date_to) }} · {{ nights(p) }} ноч.</span>
					</div>
					<span v-if="stayState(p)" class="stays__tag">{{ stayState(p) }}</span>
				</li>
			</ol>
			<a v-if="hotel?.phone" :href="tel(hotel.phone)" class="call"><Icon name="phone" /> Позвонить коменданту <span class="muted nowrap">{{ hotel.phone }}</span></a>
		</Card>

		<Card title="Для соседей" subtitle="Что видят соседи по комнате" stack class="k-rise" style="--i: 2">
			<Field label="Телефон"><Input v-model="phone" type="tel" placeholder="+7 …" autocomplete="tel" /></Field>
			<div class="privacy">
				<Switch v-model="showContacts" label="Показывать телефон соседям" hint="Имя и «о себе» видны всегда. Телефон — только если включено." />
			</div>
			<Field label="О себе"><Textarea v-model="about" :rows="3" placeholder="Пара слов: откуда, чем увлекаетесь" /></Field>
			<Button variant="primary" icon="check" :loading="savingProfile" @click="saveProfile">Сохранить</Button>
		</Card>

		<Card title="Оформление" stack class="k-rise" style="--i: 3">
			<div class="row-between">
				<span>Тема</span>
				<SegmentedControl :model-value="theme" :options="THEMES" @update:model-value="(v) => setTheme(v)" />
			</div>
		</Card>

		<Card title="Пароль" stack class="k-rise" style="--i: 4">
			<Field label="Текущий пароль"><Input v-model="curPass" type="password" autocomplete="current-password" /></Field>
			<Field label="Новый пароль" hint="Не короче 6 символов"><Input v-model="newPass" type="password" autocomplete="new-password" /></Field>
			<Button icon="lock" :loading="savingPass" @click="changePassword">Изменить пароль</Button>
		</Card>

		<button type="button" class="logout k-rise" style="--i: 5" @click="logout"><Icon name="log-out" /> Выйти из кабинета</button>
	</div>
</template>

<style scoped>
.prof {
	display: grid;
	gap: var(--gap-lg);
	max-width: 600px;
}
.me {
	display: flex;
	align-items: center;
	gap: var(--gap-lg);
	padding: var(--gap-lg);
	border-radius: var(--radius-xl);
	background: radial-gradient(360px 180px at 0% 0%, color-mix(in srgb, var(--color-brand) 20%, transparent), transparent 70%), var(--color-raised-bg);
	border: 1px solid var(--color-divider);
}
.me__photo {
	position: relative;
	flex-shrink: 0;
	cursor: pointer;
	border-radius: 50%;
	transition: transform var(--speed-fast);
}
.me__photo:active {
	transform: scale(0.96);
}
.me__photo.busy {
	opacity: 0.6;
	pointer-events: none;
}
.me__cam {
	position: absolute;
	right: -2px;
	bottom: -2px;
	display: grid;
	place-items: center;
	width: 1.9rem;
	height: 1.9rem;
	border-radius: 50%;
	background: var(--color-brand);
	color: var(--color-accent-contrast);
	border: 3px solid var(--color-raised-bg);
}
.me__text {
	min-width: 0;
}
.me__text h2 {
	font-size: var(--font-size-lg);
	line-height: 1.25;
}
.me__text p {
	margin: 2px 0 0;
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
}
.me__tags {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: var(--gap-sm);
}
.me__tags span {
	padding: 2px 10px;
	border-radius: 999px;
	background: var(--color-button-bg);
	font-size: var(--font-size-xs);
	font-weight: var(--font-weight-bold);
}
.me__rm {
	margin-top: 6px;
	padding: 0;
	border: none;
	background: none;
	color: var(--color-secondary);
	font: inherit;
	font-size: var(--font-size-xs);
	text-decoration: underline;
	cursor: pointer;
}
.totals {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-sm);
}
.totals div {
	display: grid;
	padding: var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
}
.totals b {
	font-size: 1.6rem;
	line-height: 1.1;
	color: var(--color-brand);
}
.totals span {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.stays {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
}
.stays li {
	position: relative;
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	padding: var(--gap-sm) 0;
	font-size: var(--font-size-sm);
}
/* линия времени между точками */
.stays li + li::before {
	content: "";
	position: absolute;
	left: 5px;
	top: -50%;
	height: 100%;
	width: 2px;
	background: var(--color-divider);
}
.stays__dot {
	position: relative;
	z-index: 1;
	width: 12px;
	height: 12px;
	border-radius: 50%;
	background: var(--color-divider);
	flex-shrink: 0;
}
.stays li.now .stays__dot {
	background: var(--color-brand);
	box-shadow: 0 0 0 4px var(--color-brand-highlight);
}
.stays .grow {
	display: grid;
	min-width: 0;
}
.stays b {
	color: var(--color-contrast);
}
.stays .muted {
	font-size: var(--font-size-xs);
}
.stays__tag {
	padding: 2px 10px;
	border-radius: 999px;
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	font-size: var(--font-size-xs);
	font-weight: var(--font-weight-bold);
}
.call {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-green-bg);
	color: var(--color-green);
	font-weight: var(--font-weight-bold);
	font-size: var(--font-size-sm);
}
.call .muted {
	margin-left: auto;
	font-weight: 400;
}
.privacy {
	padding: var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.row-between {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--gap-md);
	font-size: var(--font-size-sm);
	color: var(--color-contrast);
	font-weight: var(--font-weight-bold);
}
.logout {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: var(--gap-sm);
	height: var(--control-h-lg);
	border-radius: var(--radius-lg);
	border: 1px solid color-mix(in srgb, var(--color-red) 40%, var(--color-divider));
	background: transparent;
	color: var(--color-red);
	font: inherit;
	font-weight: var(--font-weight-bold);
	cursor: pointer;
}
.logout:hover {
	background: var(--color-red-bg);
}
</style>
