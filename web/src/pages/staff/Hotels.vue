<script setup>
import { ref, onMounted, computed } from "vue"
import { api, post, put, del, uploadFile } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import { amenityIcon } from "@/icons"
import Icon from "@/components/Icon.vue"
import MapView from "@/components/MapView.vue"
import Stars from "@/components/Stars.vue"
import {
	PageHeader, Tabs, Card, DataTable, Drawer, Field, Input, Textarea, Select, Button, IconButton,
	Chip, Avatar, EmptyState, confirm,
} from "@/ui"

const auth = useAuthStore()
const canEdit = auth.can("editor")
const canAdmin = auth.can("admin")

const view = ref("hotels")
const viewOptions = [
	{ value: "hotels", label: "Гостиницы", icon: "building" },
	{ value: "rooms", label: "Номера", icon: "bed" },
]

const hotels = ref([])
const rooms = ref([])
const amenities = ref([])
const loading = ref(true)

async function loadAll() {
	;[hotels.value, rooms.value, amenities.value] = await Promise.all([api("/hotels"), api("/rooms"), api("/amenities")])
}
onMounted(async () => {
	try {
		await loadAll()
	} finally {
		loading.value = false
	}
})

function toggle(list, id) {
	const i = list.indexOf(id)
	if (i >= 0) list.splice(i, 1)
	else list.push(id)
}

/* ---- Гостиница ---- */
const hotelModal = ref(null)
const hotelTab = ref("overview")
const busy = ref(false)
const HOTEL_TABS = [
	{ value: "overview", label: "Обзор" },
	{ value: "places", label: "Что рядом" },
	{ value: "info", label: "Разделы" },
	{ value: "reviews", label: "Отзывы" },
	{ value: "photos", label: "Фото" },
]

function newHotel() {
	hotelTab.value = "overview"
	hotelModal.value = { name: "", settlement: "", address: "", phone: "", email: "", check_in: "", check_out: "", latitude: "", longitude: "", description: "", rules: "", amenity_ids: [], places: [], info: [], images: [] }
}
async function editHotel(h) {
	hotelTab.value = "overview"
	const full = await api("/hotels/" + h.id)
	hotelModal.value = { ...full, amenity_ids: full.amenities.map((a) => a.id) }
	loadReviews(hotelModal.value)
}
async function saveHotel() {
	const m = hotelModal.value
	if (!m.name?.trim()) return toast.error("Укажите название")
	busy.value = true
	try {
		const id = m.id || (await post("/hotels", m)).id
		if (m.id) await put("/hotels/" + id, m)
		await put(`/hotels/${id}/amenities`, { amenity_ids: m.amenity_ids })
		if (!m.id) {
			const full = await api("/hotels/" + id)
			hotelModal.value = { ...full, amenity_ids: full.amenities.map((a) => a.id) }
		}
		await loadAll()
		toast.success("Сохранено")
	} catch (e) {
		toast.error(e.message)
	} finally {
		busy.value = false
	}
}
async function removeHotel(h) {
	if (!(await confirm({ title: `Удалить «${h.name}»?`, message: "Гостиница удалится со всеми номерами.", danger: true, confirmLabel: "Удалить" }))) return
	await del("/hotels/" + h.id)
	toast.success("Удалено")
	loadAll()
}

const hotelPickMarkers = computed(() => {
	const m = hotelModal.value
	if (!m || !m.latitude || !m.longitude) return []
	return [{ id: "h", lat: m.latitude, lng: m.longitude, color: "#c78aff" }]
})
const placePickMarkers = computed(() => {
	const m = hotelModal.value
	if (!m) return []
	const markers = []
	if (m.latitude && m.longitude) markers.push({ id: "hotel", lat: m.latitude, lng: m.longitude, color: "#c78aff", title: m.name || "Гостиница" })
	for (const p of m.places || []) {
		if (p.latitude && p.longitude) markers.push({ id: "place-" + p.id, lat: p.latitude, lng: p.longitude, color: "#4f9cff", title: p.name })
	}
	if (m._placeLat && m._placeLng) markers.push({ id: "draft-place", lat: m._placeLat, lng: m._placeLng, color: "#1bd96a", title: m._placeName || "Новая точка" })
	return markers
})
function pickHotel(e) {
	if (!hotelModal.value) return
	hotelModal.value.latitude = e.lat.toFixed(6)
	hotelModal.value.longitude = e.lng.toFixed(6)
}
function pickPlace(e) {
	if (!hotelModal.value) return
	hotelModal.value._placeLat = e.lat.toFixed(6)
	hotelModal.value._placeLng = e.lng.toFixed(6)
}

async function addPlace(m) {
	const name = m._placeName?.trim()
	if (!name || !m.id) return
	await post(`/hotels/${m.id}/places`, { name, kind: m._placeKind, distance: m._placeDist, note: m._placeNote, latitude: m._placeLat, longitude: m._placeLng })
	m.places = await api(`/hotels/${m.id}/places`)
	m._placeName = m._placeKind = m._placeDist = m._placeNote = m._placeLat = m._placeLng = ""
}
async function removePlace(m, p) {
	await del("/places/" + p.id)
	m.places = await api(`/hotels/${m.id}/places`)
}
async function addInfo(m) {
	const title = m._infoTitle?.trim()
	const body = m._infoBody?.trim()
	if (!title || !body || !m.id) return
	try {
		await post(`/hotels/${m.id}/info`, { title, body, sort: m.info?.length || 0 })
		m.info = (await api("/hotels/" + m.id)).info
		m._infoTitle = m._infoBody = ""
	} catch (e) {
		toast.error(e.message)
	}
}
async function removeInfo(m, s) {
	await del("/info/" + s.id)
	m.info = (await api("/hotels/" + m.id)).info
}
async function loadReviews(m) {
	if (!m.id) return
	const { reviews } = await api(`/hotels/${m.id}/reviews`)
	m.reviews = reviews.map((r) => ({ ...r, _reply: r.reply || "" }))
}
async function replyReview(m, r) {
	try {
		await put("/reviews/" + r.id + "/reply", { reply: r._reply || "" })
		toast.success("Ответ сохранён")
		await loadReviews(m)
	} catch (e) {
		toast.error(e.message)
	}
}
async function addHotelImg(m) {
	if (!m._imgUrl?.trim() || !m.id) return
	try {
		await post(`/hotels/${m.id}/images`, { url: m._imgUrl.trim() })
		m.images = (await api("/hotels/" + m.id)).images
		m._imgUrl = ""
	} catch (e) {
		toast.error(e.message)
	}
}
async function uploadHotelImg(m, e) {
	const file = e.target.files?.[0]
	if (!file || !m.id) return
	try {
		const url = await uploadFile(file)
		await post(`/hotels/${m.id}/images`, { url })
		m.images = (await api("/hotels/" + m.id)).images
	} catch (err) {
		toast.error(err.message)
	} finally {
		e.target.value = ""
	}
}

/* ---- Номер ---- */
const roomModal = ref(null)
const roomColumns = [
	{ key: "number", label: "Номер", sortable: true },
	{ key: "hotel_name", label: "Гостиница", sortable: true },
	{ key: "class_name", label: "Тип" },
	{ key: "capacity", label: "Мест", align: "center" },
]
function newRoom() {
	roomModal.value = { hotel_id: hotels.value[0]?.id, class_id: "", number: "", floor: "", capacity: 1, description: "", amenity_ids: [], images: [] }
}
function editRoom(r) {
	roomModal.value = { ...r, class_id: r.class_id || "", amenity_ids: [...(r.amenity_ids || [])] }
}
async function saveRoom() {
	const m = roomModal.value
	if (!m.number?.trim()) return toast.error("Укажите номер")
	busy.value = true
	try {
		const id = m.id || (await post("/rooms", m)).id
		if (m.id) await put("/rooms/" + id, m)
		await put(`/rooms/${id}/amenities`, { amenity_ids: m.amenity_ids })
		roomModal.value = null
		await loadAll()
		toast.success("Сохранено")
	} catch (e) {
		toast.error(e.message)
	} finally {
		busy.value = false
	}
}
async function removeRoom(r) {
	if (!(await confirm({ title: `Удалить номер № ${r.number}?`, danger: true, confirmLabel: "Удалить" }))) return
	await del("/rooms/" + r.id)
	toast.success("Удалено")
	loadAll()
}
async function addRoomImg(m) {
	if (!m._imgUrl?.trim() || !m.id) return
	try {
		await post(`/rooms/${m.id}/images`, { url: m._imgUrl.trim() })
		const r = (await api("/rooms")).find((x) => x.id === m.id)
		m.images = r ? r.images : []
		m._imgUrl = ""
	} catch (e) {
		toast.error(e.message)
	}
}
async function uploadRoomImg(m, e) {
	const file = e.target.files?.[0]
	if (!file || !m.id) return
	try {
		const url = await uploadFile(file)
		await post(`/rooms/${m.id}/images`, { url })
		const r = (await api("/rooms")).find((x) => x.id === m.id)
		m.images = r ? r.images : []
	} catch (err) {
		toast.error(err.message)
	} finally {
		e.target.value = ""
	}
}
async function removeImg(m, img) {
	await del("/images/" + img.id)
	m.images = (m.images || []).filter((x) => x.id !== img.id)
}

const classes = ref([])
onMounted(async () => {
	classes.value = await api("/classes")
})
</script>

<template>
	<div class="grid">
		<PageHeader title="Гостиницы и номера" icon="building">
			<template #actions>
				<Button v-if="canEdit && view === 'hotels'" variant="primary" icon="plus" @click="newHotel">Гостиница</Button>
				<Button v-if="canEdit && view === 'rooms'" variant="primary" icon="plus" @click="newRoom">Номер</Button>
			</template>
		</PageHeader>

		<Tabs v-model="view" :options="viewOptions" />

		<!-- Гостиницы -->
		<div v-if="view === 'hotels'" class="hotels-grid">
			<Card v-for="h in hotels" :key="h.id" interactive pad="md" @click="canEdit && editHotel(h)">
				<div class="row" style="gap: var(--gap-md)">
					<Avatar :name="h.name" size="2.6rem" />
					<div class="grow">
						<div class="contrast" style="font-weight: 700">{{ h.name }}</div>
						<div class="muted" style="font-size: var(--font-size-sm)">{{ [h.settlement, h.address].filter(Boolean).join(" · ") || "—" }}</div>
					</div>
					<IconButton v-if="canAdmin" icon="trash" label="Удалить" size="sm" variant="danger" @click.stop="removeHotel(h)" />
				</div>
			</Card>
			<EmptyState v-if="!loading && !hotels.length" icon="building" title="Гостиниц нет" />
		</div>

		<!-- Номера -->
		<DataTable v-else :columns="roomColumns" :rows="rooms" :loading="loading" @row-click="canEdit && editRoom($event)" empty-title="Номеров нет" empty-icon="bed">
			<template #cell-number="{ row }"><b class="contrast">№ {{ row.number }}</b><span v-if="row.floor != null" class="muted" style="font-size: var(--font-size-xs)"> · этаж {{ row.floor }}</span></template>
			<template #cell-class_name="{ value }"><Chip>{{ value || "—" }}</Chip></template>
			<template #actions="{ row }">
				<IconButton icon="pencil" label="Изменить" size="sm" @click="editRoom(row)" />
				<IconButton icon="trash" label="Удалить" size="sm" variant="danger" @click="removeRoom(row)" />
			</template>
		</DataTable>

		<!-- Drawer гостиницы -->
		<Drawer v-if="hotelModal" :title="hotelModal.id ? hotelModal.name : 'Новая гостиница'" width="600px" @close="hotelModal = null">
			<Tabs v-if="hotelModal.id" v-model="hotelTab" :options="HOTEL_TABS" style="margin-bottom: var(--gap-lg)" />

			<template v-if="hotelTab === 'overview' || !hotelModal.id">
				<div class="two"><Field label="Название"><Input v-model="hotelModal.name" /></Field><Field label="Посёлок"><Input v-model="hotelModal.settlement" /></Field></div>
				<div class="two"><Field label="Адрес"><Input v-model="hotelModal.address" /></Field><Field label="Телефон коменданта"><Input v-model="hotelModal.phone" /></Field></div>
				<div class="two"><Field label="E-mail"><Input v-model="hotelModal.email" /></Field><Field label="Заезд / выезд"><div class="row"><Input v-model="hotelModal.check_in" placeholder="14:00" /><Input v-model="hotelModal.check_out" placeholder="12:00" /></div></Field></div>
				<div class="two"><Field label="Широта"><Input v-model="hotelModal.latitude" placeholder="51.97" /></Field><Field label="Долгота"><Input v-model="hotelModal.longitude" placeholder="116.54" /></Field></div>
				<Field label="Точка на карте (клик)">
					<MapView :markers="hotelPickMarkers" :center="hotelModal.latitude && hotelModal.longitude ? [Number(hotelModal.latitude), Number(hotelModal.longitude)] : [54.4, 113.0]" :zoom="hotelModal.latitude ? 13 : 4" :fit="false" click-to-pick height="220px" @pick="pickHotel" />
				</Field>
				<Field label="Описание"><Textarea v-model="hotelModal.description" :rows="2" /></Field>
				<Field label="Правила"><Textarea v-model="hotelModal.rules" :rows="2" /></Field>
				<Field label="Удобства дома">
					<div class="row wrap">
						<button v-for="a in amenities.filter((x) => x.scope !== 'room')" :key="a.id" type="button" class="pickchip" :class="{ on: hotelModal.amenity_ids.includes(a.id) }" @click="toggle(hotelModal.amenity_ids, a.id)"><Icon :name="amenityIcon(a.icon)" /> {{ a.name }}</button>
					</div>
				</Field>
			</template>

			<template v-else-if="hotelTab === 'places'">
				<div v-for="p in hotelModal.places" :key="p.id" class="li"><span class="grow">{{ p.name }} <span class="muted">{{ p.distance }}</span><span v-if="p.latitude" class="muted" style="font-size: var(--font-size-xs)"> · на карте</span></span><IconButton icon="x" label="Удалить" size="sm" variant="danger" @click="removePlace(hotelModal, p)" /></div>
				<Field label="Точка рядом на карте (клик)">
					<MapView
						:markers="placePickMarkers"
						:center="hotelModal._placeLat && hotelModal._placeLng ? [Number(hotelModal._placeLat), Number(hotelModal._placeLng)] : hotelModal.latitude && hotelModal.longitude ? [Number(hotelModal.latitude), Number(hotelModal.longitude)] : [52.36, 115.51]"
						:zoom="hotelModal.latitude ? 15 : 12"
						:fit="false"
						click-to-pick
						height="220px"
						@pick="pickPlace"
					/>
				</Field>
				<div class="row wrap" style="margin-top: var(--gap-sm)">
					<Input v-model="hotelModal._placeName" placeholder="Название" style="min-width: 120px" />
					<Input v-model="hotelModal._placeKind" placeholder="Тип (Питание…)" style="width: 130px" />
					<Input v-model="hotelModal._placeDist" placeholder="Расстояние" style="width: 110px" />
					<Input v-model="hotelModal._placeLat" placeholder="Широта" style="width: 100px" />
					<Input v-model="hotelModal._placeLng" placeholder="Долгота" style="width: 100px" />
					<Button icon="plus" @click="addPlace(hotelModal)">Добавить</Button>
				</div>
			</template>

			<template v-else-if="hotelTab === 'info'">
				<div v-for="s in hotelModal.info || []" :key="s.id" class="li"><span class="grow"><b class="contrast">{{ s.title }}</b> <span class="muted" style="font-size: var(--font-size-xs)">{{ s.body.slice(0, 40) }}…</span></span><IconButton icon="x" label="Удалить" size="sm" variant="danger" @click="removeInfo(hotelModal, s)" /></div>
				<div class="grid" style="gap: var(--gap-sm); margin-top: var(--gap-sm)">
					<Input v-model="hotelModal._infoTitle" placeholder="Заголовок (напр. Распорядок дня)" />
					<Textarea v-model="hotelModal._infoBody" :rows="2" placeholder="Текст раздела" />
					<Button icon="plus" style="width: fit-content" @click="addInfo(hotelModal)">Добавить раздел</Button>
				</div>
			</template>

			<template v-else-if="hotelTab === 'reviews'">
				<EmptyState v-if="!hotelModal.reviews?.length" icon="message-square" text="Отзывов пока нет" />
				<div v-for="r in hotelModal.reviews" :key="r.id" class="review">
					<div class="spread"><b class="contrast">{{ r.resident_name || "Аноним" }}</b> <Stars :model-value="r.rating" readonly /></div>
					<div v-if="r.text" style="font-size: var(--font-size-sm)">{{ r.text }}</div>
					<div class="row" style="margin-top: 4px"><Input v-model="r._reply" placeholder="Ответ администрации…" /><Button size="sm" @click="replyReview(hotelModal, r)">Ответить</Button></div>
				</div>
			</template>

			<template v-else-if="hotelTab === 'photos'">
				<div v-if="hotelModal.images?.length" class="thumbs">
					<div v-for="img in hotelModal.images" :key="img.id" class="thumb"><img :src="img.url" alt="" /><button class="thumb-x" @click="removeImg(hotelModal, img)"><Icon name="x" /></button></div>
				</div>
				<div class="row wrap" style="margin-top: var(--gap-sm)">
					<Input v-model="hotelModal._imgUrl" placeholder="https://… ссылка" @keyup.enter="addHotelImg(hotelModal)" />
					<Button @click="addHotelImg(hotelModal)">По ссылке</Button>
					<label class="btn btn-sm" style="cursor: pointer"><Icon name="upload" /> Файл<input type="file" accept="image/*" hidden @change="uploadHotelImg(hotelModal, $event)" /></label>
				</div>
			</template>

			<template #foot>
				<Button variant="ghost" @click="hotelModal = null">Закрыть</Button>
				<Button v-if="hotelTab === 'overview' || !hotelModal.id" variant="primary" :loading="busy" @click="saveHotel">Сохранить</Button>
			</template>
		</Drawer>

		<!-- Drawer номера -->
		<Drawer v-if="roomModal" :title="roomModal.id ? 'Номер № ' + roomModal.number : 'Новый номер'" @close="roomModal = null">
			<Field v-if="!roomModal.id" label="Гостиница"><Select v-model="roomModal.hotel_id"><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></Select></Field>
			<div class="two"><Field label="Номер"><Input v-model="roomModal.number" /></Field><Field label="Тип"><Select v-model="roomModal.class_id"><option value="">—</option><option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}</option></Select></Field></div>
			<div class="two"><Field label="Этаж"><Input v-model="roomModal.floor" type="number" /></Field><Field label="Кол-во мест"><Input v-model="roomModal.capacity" type="number" /></Field></div>
			<Field label="Описание"><Textarea v-model="roomModal.description" :rows="2" /></Field>
			<Field label="Удобства номера">
				<div class="row wrap">
					<button v-for="a in amenities.filter((x) => x.scope !== 'hotel')" :key="a.id" type="button" class="pickchip" :class="{ on: roomModal.amenity_ids.includes(a.id) }" @click="toggle(roomModal.amenity_ids, a.id)"><Icon :name="amenityIcon(a.icon)" /> {{ a.name }}</button>
				</div>
			</Field>
			<Field v-if="roomModal.id" label="Фото номера">
				<div v-if="roomModal.images?.length" class="thumbs">
					<div v-for="img in roomModal.images" :key="img.id" class="thumb"><img :src="img.url" alt="" /><button class="thumb-x" @click="removeImg(roomModal, img)"><Icon name="x" /></button></div>
				</div>
				<div class="row wrap" style="margin-top: var(--gap-sm)">
					<Input v-model="roomModal._imgUrl" placeholder="https://… ссылка" @keyup.enter="addRoomImg(roomModal)" />
					<Button @click="addRoomImg(roomModal)">По ссылке</Button>
					<label class="btn btn-sm" style="cursor: pointer"><Icon name="upload" /> Файл<input type="file" accept="image/*" hidden @change="uploadRoomImg(roomModal, $event)" /></label>
				</div>
			</Field>
			<p v-else class="muted" style="font-size: var(--font-size-xs)">Сохраните номер, затем добавьте фото.</p>
			<template #foot>
				<Button variant="ghost" @click="roomModal = null">Отмена</Button>
				<Button variant="primary" :loading="busy" @click="saveRoom">Сохранить</Button>
			</template>
		</Drawer>
	</div>
</template>

<style scoped>
.hotels-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	gap: var(--gap-md);
}
.two {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-md);
}
.li {
	display: flex;
	gap: var(--gap-sm);
	align-items: center;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	margin-bottom: var(--gap-xs);
}
.pickchip {
	display: inline-flex;
	align-items: center;
	gap: var(--gap-xs);
	padding: 4px var(--gap-sm);
	border-radius: var(--radius-max);
	font-size: var(--font-size-sm);
	font-weight: var(--font-weight-medium);
	background: var(--color-button-bg);
	border: 1px solid var(--color-divider);
	color: var(--color-base);
	cursor: pointer;
}
.pickchip.on {
	background: var(--color-brand-highlight);
	border-color: var(--color-brand);
	color: var(--color-brand);
}
.review {
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	margin-bottom: var(--gap-sm);
}
.thumbs {
	display: flex;
	flex-wrap: wrap;
	gap: var(--gap-sm);
}
.thumb {
	position: relative;
	width: 84px;
	height: 64px;
	border-radius: var(--radius-sm);
	overflow: hidden;
	border: 1px solid var(--color-divider);
}
.thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}
.thumb-x {
	position: absolute;
	top: 2px;
	right: 2px;
	background: rgba(0, 0, 0, 0.6);
	color: #fff;
	border: none;
	border-radius: var(--radius-sm);
	cursor: pointer;
	padding: 1px 3px;
	display: flex;
}
</style>
