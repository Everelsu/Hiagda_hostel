<script setup>
import { ref, onMounted, computed } from "vue"
import { api, post, put, del, uploadFile, download } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import { amenityIcon } from "@/icons"
import Icon from "@/components/Icon.vue"
import MapView from "@/components/MapView.vue"
import Stars from "@/components/Stars.vue"
import {
	PageHeader, Tabs, Card, Drawer, Field, Input, Textarea, Select, Button, IconButton,
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
const mapStats = ref([])
const loading = ref(true)

// Фильтры вкладки «Номера»
const roomQuery = ref("")
const roomHotel = ref("")
const roomClass = ref("")

async function loadAll() {
	;[hotels.value, rooms.value, amenities.value, mapStats.value] = await Promise.all([
		api("/hotels"),
		api("/rooms"),
		api("/amenities"),
		api("/map").catch(() => []),
	])
}

// Загрузка по домам берётся из того же источника, что и карта
const statsFor = (id) => mapStats.value.find((m) => m.id === id) || null

const visibleRooms = computed(() => {
	const q = roomQuery.value.trim().toLowerCase()
	return rooms.value.filter((r) => {
		if (roomHotel.value && String(r.hotel_id) !== String(roomHotel.value)) return false
		if (roomClass.value && r.class_name !== roomClass.value) return false
		if (!q) return true
		return [r.number, r.class_name, r.description].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
	})
})
const roomClassOptions = computed(() => [...new Set(rooms.value.map((r) => r.class_name).filter(Boolean))])
const amenityById = computed(() => new Map(amenities.value.map((a) => [a.id, a])))
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
	if (!(await confirm({ title: `Удалить «${h.name}»?`, message: "Гостиница удалится вместе со всеми номерами, местами и историей размещений. Это необратимо.", danger: true, confirmLabel: "Удалить гостиницу", typeText: h.name }))) return
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
function newRoom() {
	roomModal.value = { hotel_id: hotels.value[0]?.id, class_id: "", number: "", floor: "", capacity: 1, description: "", amenity_ids: [], images: [] }
}
function editRoom(r) {
	roomModal.value = { ...r, class_id: r.class_id || "", amenity_ids: [...(r.amenity_ids || [])] }
}
function roomReport(r) {
	download("/report/room/" + r.id)
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
			<article v-for="h in hotels" :key="h.id" class="hcard" @click="canEdit && editHotel(h)">
				<div class="hcard-head">
					<Avatar :name="h.name" size="2.6rem" />
					<div class="grow">
						<div class="hname">{{ h.name }}</div>
						<div class="muted hsub">{{ [h.settlement, h.address].filter(Boolean).join(" · ") || "Адрес не указан" }}</div>
					</div>
					<IconButton v-if="canAdmin" icon="trash" label="Удалить" size="sm" variant="danger" @click.stop="removeHotel(h)" />
				</div>

				<template v-if="statsFor(h.id)">
					<div class="hbar" :title="`Занято ${statsFor(h.id).occupancy}%`">
						<span :style="{ width: statsFor(h.id).occupancy + '%' }" />
					</div>
					<div class="hstats">
						<span><b>{{ statsFor(h.id).rooms }}</b> номеров</span>
						<span><b>{{ statsFor(h.id).free }}</b> свободно</span>
						<span><b>{{ statsFor(h.id).beds }}</b> мест</span>
						<span class="occ">{{ statsFor(h.id).occupancy }}% занято</span>
					</div>
					<div v-if="statsFor(h.id).repair || statsFor(h.id).issues" class="hflags">
						<Chip v-if="statsFor(h.id).repair" color="var(--color-orange)" dot>ремонт: {{ statsFor(h.id).repair }}</Chip>
						<Chip v-if="statsFor(h.id).issues" color="var(--color-red)" dot>заявок: {{ statsFor(h.id).issues }}</Chip>
					</div>
				</template>

				<div class="hfoot muted">
					<span v-if="h.phone"><Icon name="phone" size="0.85rem" /> {{ h.phone }}</span>
					<span v-if="h.check_out"><Icon name="clock" size="0.85rem" /> выезд {{ h.check_out }}</span>
					<span v-if="canEdit" class="edit-hint"><Icon name="pencil" size="0.85rem" /> изменить</span>
				</div>
			</article>
			<EmptyState v-if="!loading && !hotels.length" icon="building" title="Гостиниц нет" />
		</div>

		<!-- Номера -->
		<template v-else>
			<Card pad="md" class="rfilters">
				<Input v-model="roomQuery" placeholder="Поиск по номеру или описанию…" style="flex: 1; min-width: 180px" />
				<Select v-model="roomHotel" style="width: auto">
					<option value="">Все дома</option>
					<option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option>
				</Select>
				<Select v-model="roomClass" style="width: auto">
					<option value="">Все типы</option>
					<option v-for="c in roomClassOptions" :key="c" :value="c">{{ c }}</option>
				</Select>
				<span class="muted rcount">{{ visibleRooms.length }} из {{ rooms.length }}</span>
			</Card>

			<EmptyState v-if="!loading && !visibleRooms.length" icon="bed" title="Номеров не найдено" text="Измените фильтры или добавьте номер." />
			<div v-else class="rooms-grid">
				<article v-for="r in visibleRooms" :key="r.id" class="rcard" @click="canEdit && editRoom(r)">
					<div class="rcard-head">
						<span class="rnum">№ {{ r.number }}</span>
						<Chip v-if="r.class_name">{{ r.class_name }}</Chip>
						<span class="grow" />
						<span class="rcap"><Icon name="bed" size="0.9rem" /> {{ r.capacity }}</span>
					</div>
					<div class="muted rmeta">
						{{ r.hotel_name }}<template v-if="r.floor != null"> · этаж {{ r.floor }}</template>
					</div>
					<p v-if="r.description" class="rdesc">{{ r.description }}</p>
					<div v-if="r.amenity_ids?.length" class="ramen">
						<span v-for="id in r.amenity_ids.slice(0, 6)" :key="id" class="ra" :title="amenityById.get(id)?.name">
							<Icon :name="amenityIcon(amenityById.get(id)?.icon)" size="0.9rem" />
						</span>
						<span v-if="r.amenity_ids.length > 6" class="ra more">+{{ r.amenity_ids.length - 6 }}</span>
					</div>
					<div class="rcard-foot">
						<IconButton icon="download" label="Отчёт в Excel" size="sm" @click.stop="roomReport(r)" />
						<IconButton v-if="canEdit" icon="pencil" label="Изменить" size="sm" @click.stop="editRoom(r)" />
						<IconButton v-if="canEdit" icon="trash" label="Удалить" size="sm" variant="danger" @click.stop="removeRoom(r)" />
					</div>
				</article>
			</div>
		</template>

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
					<div class="spread">
					<span class="row" style="gap: var(--gap-sm)">
						<b class="contrast">{{ r.resident_name || "Аноним" }}</b>
						<Chip v-if="r.room_number" color="var(--color-blue)" dot>№ {{ r.room_number }}</Chip>
						<Chip v-else dot>о доме</Chip>
					</span>
					<Stars :model-value="r.rating" readonly />
				</div>
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
				<Button v-if="roomModal.id" icon="download" @click="roomReport(roomModal)">Excel</Button>
				<Button variant="ghost" @click="roomModal = null">Отмена</Button>
				<Button variant="primary" :loading="busy" @click="saveRoom">Сохранить</Button>
			</template>
		</Drawer>
	</div>
</template>

<style scoped>
.hotels-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	gap: var(--gap-md);
}
/* Карточка дома: имя, загрузка, дежурные факты */
.hcard {
	display: grid;
	gap: var(--gap-sm);
	padding: var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	cursor: pointer;
	transition: border-color var(--speed-fast);
}
.hcard:hover {
	border-color: var(--color-brand);
}
.hcard-head {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
}
.hname {
	font-weight: 800;
	color: var(--color-contrast);
}
.hsub {
	font-size: var(--font-size-xs);
}
.hbar {
	height: 6px;
	border-radius: var(--radius-max);
	background: var(--color-bg);
	overflow: hidden;
}
.hbar span {
	display: block;
	height: 100%;
	border-radius: var(--radius-max);
	background: var(--color-brand);
}
.hstats {
	display: flex;
	gap: var(--gap-md);
	flex-wrap: wrap;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.hstats b {
	color: var(--color-contrast);
	font-size: var(--font-size-sm);
}
.hstats .occ {
	margin-left: auto;
}
.hflags {
	display: flex;
	gap: var(--gap-xs);
	flex-wrap: wrap;
}
.hfoot {
	display: flex;
	gap: var(--gap-md);
	flex-wrap: wrap;
	font-size: var(--font-size-xs);
	padding-top: var(--gap-sm);
	border-top: 1px solid var(--color-divider);
}
.hfoot span {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}
.edit-hint {
	margin-left: auto;
	opacity: 0.7;
}

/* Номера */
.rfilters {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	flex-wrap: wrap;
}
.rcount {
	font-size: var(--font-size-xs);
	white-space: nowrap;
}
.rooms-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
	gap: var(--gap-md);
}
.rcard {
	display: grid;
	gap: var(--gap-xs);
	align-content: start;
	padding: var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	cursor: pointer;
	transition: border-color var(--speed-fast);
}
.rcard:hover {
	border-color: var(--color-brand);
}
.rcard-head {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
}
.rnum {
	font-weight: 800;
	font-size: var(--font-size-lg);
	color: var(--color-contrast);
}
.rcap {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: var(--font-size-sm);
	font-weight: 700;
	color: var(--color-secondary);
}
.rmeta {
	font-size: var(--font-size-xs);
}
.rdesc {
	margin: 0;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
.ramen {
	display: flex;
	gap: 4px;
	flex-wrap: wrap;
}
.ra {
	display: grid;
	place-items: center;
	width: 1.6rem;
	height: 1.6rem;
	border-radius: var(--radius-sm);
	background: var(--color-bg);
	color: var(--color-brand);
}
.ra.more {
	font-size: 10px;
	font-weight: 700;
	color: var(--color-secondary);
}
.rcard-foot {
	display: flex;
	gap: var(--gap-xs);
	justify-content: flex-end;
	padding-top: var(--gap-xs);
	border-top: 1px solid var(--color-divider);
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
