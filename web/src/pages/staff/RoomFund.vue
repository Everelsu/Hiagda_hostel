<script setup>
import { ref, onMounted } from "vue"
import { api, post, put, del } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import { amenityIcon } from "@/icons"
import Modal from "@/components/Modal.vue"
import Icon from "@/components/Icon.vue"

const auth = useAuthStore()
const tab = ref("hotels")
const TABS = [
	["hotels", "Гостиницы"],
	["rooms", "Номера"],
	["classes", "Типы"],
	["statuses", "Статусы"],
	["amenities", "Удобства"],
]

const hotels = ref([])
const rooms = ref([])
const classes = ref([])
const statuses = ref([])
const amenities = ref([])

async function loadAll() {
	;[hotels.value, rooms.value, classes.value, statuses.value, amenities.value] = await Promise.all([
		api("/hotels"),
		api("/rooms"),
		api("/classes"),
		api("/statuses"),
		api("/amenities"),
	])
}
onMounted(loadAll)

/* ---- Гостиницы ---- */
const hotelModal = ref(null)
function newHotel() {
	hotelModal.value = { name: "", location: "", settlement: "", address: "", phone: "", email: "", check_in: "", check_out: "", latitude: "", longitude: "", description: "", rules: "", amenity_ids: [], places: [] }
}
async function editHotel(h) {
	const full = await api("/hotels/" + h.id)
	hotelModal.value = { ...full, amenity_ids: full.amenities.map((a) => a.id) }
}
async function saveHotel() {
	const m = hotelModal.value
	try {
		const id = m.id || (await post("/hotels", m)).id
		if (m.id) await put("/hotels/" + id, m)
		await put(`/hotels/${id}/amenities`, { amenity_ids: m.amenity_ids })
		hotelModal.value = null
		await loadAll()
		toast("Сохранено")
	} catch (e) {
		toast(e.message)
	}
}
async function removeHotel(h) {
	if (!confirm(`Удалить гостиницу «${h.name}» со всеми номерами?`)) return
	await del("/hotels/" + h.id)
	loadAll()
}
async function addPlace(m) {
	const name = m._placeName?.trim()
	if (!name || !m.id) return
	await post(`/hotels/${m.id}/places`, { name, kind: m._placeKind, distance: m._placeDist, note: m._placeNote })
	m.places = await api(`/hotels/${m.id}/places`)
	m._placeName = m._placeKind = m._placeDist = m._placeNote = ""
}
async function removePlace(m, p) {
	await del("/places/" + p.id)
	m.places = await api(`/hotels/${m.id}/places`)
}
async function addHotelImg(m) {
	if (!m._imgUrl?.trim() || !m.id) return
	try {
		await post(`/hotels/${m.id}/images`, { url: m._imgUrl.trim() })
		m.images = (await api("/hotels/" + m.id)).images
		m._imgUrl = ""
	} catch (e) {
		toast(e.message)
	}
}
async function addRoomImg(m) {
	if (!m._imgUrl?.trim() || !m.id) return
	try {
		await post(`/rooms/${m.id}/images`, { url: m._imgUrl.trim() })
		const r = (await api("/rooms")).find((x) => x.id === m.id)
		m.images = r ? r.images : []
		m._imgUrl = ""
	} catch (e) {
		toast(e.message)
	}
}
async function removeImg(m, img) {
	await del("/images/" + img.id)
	m.images = (m.images || []).filter((x) => x.id !== img.id)
}

/* ---- Номера ---- */
const roomModal = ref(null)
function newRoom() {
	roomModal.value = { hotel_id: hotels.value[0]?.id, class_id: "", number: "", floor: "", capacity: 1, description: "", amenity_ids: [] }
}
function editRoom(r) {
	roomModal.value = { ...r, class_id: r.class_id || "", amenity_ids: [...(r.amenity_ids || [])] }
}
async function saveRoom() {
	const m = roomModal.value
	try {
		const id = m.id || (await post("/rooms", m)).id
		if (m.id) await put("/rooms/" + id, m)
		await put(`/rooms/${id}/amenities`, { amenity_ids: m.amenity_ids })
		roomModal.value = null
		await loadAll()
		toast("Сохранено")
	} catch (e) {
		toast(e.message)
	}
}
async function removeRoom(r) {
	if (!confirm(`Удалить номер № ${r.number}?`)) return
	await del("/rooms/" + r.id)
	loadAll()
}
function toggle(list, id) {
	const i = list.indexOf(id)
	if (i >= 0) list.splice(i, 1)
	else list.push(id)
}

/* ---- Типы / Статусы / Удобства ---- */
const newClass = ref("")
async function addClass() {
	if (!newClass.value.trim()) return
	try {
		await post("/classes", { name: newClass.value.trim() })
		newClass.value = ""
		classes.value = await api("/classes")
	} catch (e) {
		toast(e.message)
	}
}
async function removeClass(c) {
	if (!confirm(`Удалить тип «${c.name}»?`)) return
	try {
		await del("/classes/" + c.id)
		classes.value = await api("/classes")
	} catch (e) {
		toast(e.message)
	}
}

const newStatus = ref({ name: "", color: "#1bd96a" })
async function addStatus() {
	if (!newStatus.value.name) return
	try {
		await post("/statuses", { ...newStatus.value, sort: statuses.value.length })
		newStatus.value = { name: "", color: "#1bd96a" }
		statuses.value = await api("/statuses")
	} catch (e) {
		toast(e.message)
	}
}
async function removeStatus(s) {
	if (!confirm(`Удалить статус «${s.name}»?`)) return
	try {
		await del("/statuses/" + s.id)
		statuses.value = await api("/statuses")
	} catch (e) {
		toast(e.message)
	}
}

const newAmenity = ref({ name: "", icon: "dot", scope: "both" })
const ICON_OPTIONS = ["dot", "wifi", "tv", "shower", "fridge", "snow", "utensils", "washer", "wind", "dumbbell", "sofa"]
async function addAmenity() {
	if (!newAmenity.value.name) return
	try {
		await post("/amenities", { ...newAmenity.value })
		newAmenity.value = { name: "", icon: "dot", scope: "both" }
		amenities.value = await api("/amenities")
	} catch (e) {
		toast(e.message)
	}
}
async function removeAmenity(a) {
	if (!confirm(`Удалить удобство «${a.name}»?`)) return
	await del("/amenities/" + a.id)
	amenities.value = await api("/amenities")
}

const canEdit = auth.can("editor")
const canAdmin = auth.can("admin")
</script>

<template>
	<div class="grid" style="max-width: 900px">
		<h1>Номерной фонд</h1>

		<div class="tab-bar">
			<button v-for="t in TABS" :key="t[0]" class="tab-btn" :class="{ active: tab === t[0] }" @click="tab = t[0]">{{ t[1] }}</button>
		</div>

		<!-- Гостиницы -->
		<div v-if="tab === 'hotels'" class="card grid">
			<div class="spread"><div class="section-title">Гостиницы</div><button v-if="canEdit" class="btn btn-sm" @click="newHotel">+ Добавить</button></div>
			<div v-for="h in hotels" :key="h.id" class="li">
				<div class="grow">
					<div class="contrast row" style="font-weight: 700; gap: 6px"><Icon name="home" /> {{ h.name }}</div>
					<div class="muted" style="font-size: var(--font-size-sm)">{{ [h.settlement, h.address].filter(Boolean).join(" · ") || h.location || "—" }}</div>
				</div>
				<button v-if="canEdit" class="btn btn-sm" @click="editHotel(h)">Изменить</button>
				<button v-if="canAdmin" class="btn btn-sm btn-danger" @click="removeHotel(h)"><Icon name="x" /></button>
			</div>
		</div>

		<!-- Номера -->
		<div v-if="tab === 'rooms'" class="card grid">
			<div class="spread"><div class="section-title">Номера</div><button v-if="canEdit" class="btn btn-sm" @click="newRoom">+ Добавить</button></div>
			<div v-for="r in rooms" :key="r.id" class="li">
				<div class="grow">
					<div class="contrast row" style="font-weight: 700; gap: 6px"><Icon name="bed" /> № {{ r.number }}</div>
					<div class="muted" style="font-size: var(--font-size-sm)">{{ [r.hotel_name, r.class_name, r.floor != null ? "этаж " + r.floor : null, "мест: " + r.capacity].filter(Boolean).join(" · ") }}</div>
				</div>
				<button v-if="canEdit" class="btn btn-sm" @click="editRoom(r)">Изменить</button>
				<button v-if="canEdit" class="btn btn-sm btn-danger" @click="removeRoom(r)"><Icon name="x" /></button>
			</div>
		</div>

		<!-- Типы -->
		<div v-if="tab === 'classes'" class="card grid">
			<div class="section-title">Типы номеров</div>
			<div v-for="c in classes" :key="c.id" class="li"><span class="grow">{{ c.name }}</span><button v-if="canAdmin" class="btn btn-sm btn-danger" @click="removeClass(c)"><Icon name="x" /></button></div>
			<div v-if="canEdit" class="row"><input v-model="newClass" placeholder="Новый тип" @keyup.enter="addClass" /><button class="btn btn-sm" @click="addClass">+</button></div>
		</div>

		<!-- Статусы -->
		<div v-if="tab === 'statuses'" class="card grid">
			<div class="section-title">Статусы номеров</div>
			<div v-for="s in statuses" :key="s.id" class="li"><span class="dot" :style="{ background: s.color, width: '14px', height: '14px', borderRadius: '4px' }" /><span class="grow">{{ s.name }}</span><button v-if="canAdmin" class="btn btn-sm btn-danger" @click="removeStatus(s)"><Icon name="x" /></button></div>
			<div v-if="canEdit" class="row"><input v-model="newStatus.name" placeholder="Название" /><input v-model="newStatus.color" type="color" style="width: 48px; padding: 2px" /><button class="btn btn-sm" @click="addStatus">+</button></div>
		</div>

		<!-- Удобства -->
		<div v-if="tab === 'amenities'" class="card grid">
			<div class="section-title">Каталог удобств</div>
			<div v-for="a in amenities" :key="a.id" class="li"><Icon :name="amenityIcon(a.icon)" /><span class="grow">{{ a.name }} <span class="muted" style="font-size: var(--font-size-xs)">· {{ a.scope }}</span></span><button v-if="canAdmin" class="btn btn-sm btn-danger" @click="removeAmenity(a)"><Icon name="x" /></button></div>
			<div v-if="canEdit" class="row wrap">
				<input v-model="newAmenity.name" placeholder="Название" style="min-width: 140px" />
				<select v-model="newAmenity.icon" style="width: auto"><option v-for="i in ICON_OPTIONS" :key="i" :value="i">{{ i }}</option></select>
				<select v-model="newAmenity.scope" style="width: auto"><option value="both">везде</option><option value="room">номер</option><option value="hotel">дом</option></select>
				<button class="btn btn-sm" @click="addAmenity">+</button>
			</div>
		</div>

		<!-- Модалка гостиницы -->
		<Modal v-if="hotelModal" :title="hotelModal.id ? 'Гостиница' : 'Новая гостиница'" wide @close="hotelModal = null">
			<div class="row wrap">
				<div class="field grow"><label>Название</label><input v-model="hotelModal.name" /></div>
				<div class="field grow"><label>Посёлок</label><input v-model="hotelModal.settlement" /></div>
			</div>
			<div class="row wrap">
				<div class="field grow"><label>Адрес</label><input v-model="hotelModal.address" /></div>
				<div class="field grow"><label>Телефон коменданта</label><input v-model="hotelModal.phone" /></div>
			</div>
			<div class="row wrap">
				<div class="field grow"><label>E-mail</label><input v-model="hotelModal.email" /></div>
				<div class="field" style="width: 110px"><label>Заезд с</label><input v-model="hotelModal.check_in" placeholder="14:00" /></div>
				<div class="field" style="width: 110px"><label>Выезд до</label><input v-model="hotelModal.check_out" placeholder="12:00" /></div>
			</div>
			<div class="row wrap">
				<div class="field grow"><label>Широта (карта)</label><input v-model="hotelModal.latitude" placeholder="51.97" /></div>
				<div class="field grow"><label>Долгота (карта)</label><input v-model="hotelModal.longitude" placeholder="116.54" /></div>
			</div>
			<div class="field"><label>Описание</label><textarea v-model="hotelModal.description" rows="2" /></div>
			<div class="field"><label>Правила</label><textarea v-model="hotelModal.rules" rows="2" /></div>
			<div class="field">
				<label>Удобства дома</label>
				<div class="row wrap">
					<button v-for="a in amenities.filter((x) => x.scope !== 'room')" :key="a.id" type="button" class="chip pick" :class="{ on: hotelModal.amenity_ids.includes(a.id) }" @click="toggle(hotelModal.amenity_ids, a.id)"><Icon :name="amenityIcon(a.icon)" /> {{ a.name }}</button>
				</div>
			</div>
			<template v-if="hotelModal.id">
				<div class="field">
					<label>Что рядом</label>
					<div v-for="p in hotelModal.places" :key="p.id" class="li"><span class="grow">{{ p.name }} <span class="muted">{{ p.distance }}</span></span><button class="btn btn-sm btn-danger" @click="removePlace(hotelModal, p)"><Icon name="x" /></button></div>
					<div class="row wrap" style="margin-top: var(--gap-sm)">
						<input v-model="hotelModal._placeName" placeholder="Название" style="min-width: 120px" />
						<input v-model="hotelModal._placeKind" placeholder="Тип (Питание…)" style="width: 130px" />
						<input v-model="hotelModal._placeDist" placeholder="Расстояние" style="width: 110px" />
						<button class="btn btn-sm" @click="addPlace(hotelModal)">+</button>
					</div>
				</div>
				<div class="field">
					<label>Фото дома</label>
					<div v-if="hotelModal.images?.length" class="thumbs">
						<div v-for="img in hotelModal.images" :key="img.id" class="thumb"><img :src="img.url" alt="" /><button class="thumb-x" @click="removeImg(hotelModal, img)"><Icon name="x" /></button></div>
					</div>
					<div class="row" style="margin-top: var(--gap-sm)"><input v-model="hotelModal._imgUrl" placeholder="https://… ссылка на фото" @keyup.enter="addHotelImg(hotelModal)" /><button class="btn btn-sm" @click="addHotelImg(hotelModal)">Добавить</button></div>
				</div>
			</template>
			<p v-else class="muted" style="font-size: var(--font-size-xs)">Сохраните гостиницу, затем добавьте «что рядом» и фото.</p>
			<template #foot>
				<button class="btn" @click="hotelModal = null">Отмена</button>
				<button class="btn btn-primary" @click="saveHotel">Сохранить</button>
			</template>
		</Modal>

		<!-- Модалка номера -->
		<Modal v-if="roomModal" :title="roomModal.id ? 'Номер № ' + roomModal.number : 'Новый номер'" @close="roomModal = null">
			<div class="field" v-if="!roomModal.id">
				<label>Гостиница</label>
				<select v-model="roomModal.hotel_id"><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></select>
			</div>
			<div class="row wrap">
				<div class="field grow"><label>Номер</label><input v-model="roomModal.number" /></div>
				<div class="field grow"><label>Тип</label><select v-model="roomModal.class_id"><option value="">—</option><option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}</option></select></div>
			</div>
			<div class="row wrap">
				<div class="field grow"><label>Этаж</label><input v-model="roomModal.floor" type="number" /></div>
				<div class="field grow"><label>Кол-во мест</label><input v-model="roomModal.capacity" type="number" min="1" /></div>
			</div>
			<div class="field"><label>Описание</label><textarea v-model="roomModal.description" rows="2" /></div>
			<div class="field">
				<label>Удобства номера</label>
				<div class="row wrap">
					<button v-for="a in amenities.filter((x) => x.scope !== 'hotel')" :key="a.id" type="button" class="chip pick" :class="{ on: roomModal.amenity_ids.includes(a.id) }" @click="toggle(roomModal.amenity_ids, a.id)"><Icon :name="amenityIcon(a.icon)" /> {{ a.name }}</button>
				</div>
			</div>
			<div v-if="roomModal.id" class="field">
				<label>Фото номера</label>
				<div v-if="roomModal.images?.length" class="thumbs">
					<div v-for="img in roomModal.images" :key="img.id" class="thumb"><img :src="img.url" alt="" /><button class="thumb-x" @click="removeImg(roomModal, img)"><Icon name="x" /></button></div>
				</div>
				<div class="row" style="margin-top: var(--gap-sm)"><input v-model="roomModal._imgUrl" placeholder="https://… ссылка на фото" @keyup.enter="addRoomImg(roomModal)" /><button class="btn btn-sm" @click="addRoomImg(roomModal)">Добавить</button></div>
			</div>
			<p v-else class="muted" style="font-size: var(--font-size-xs)">Сохраните номер, затем добавьте фото.</p>
			<template #foot>
				<button class="btn" @click="roomModal = null">Отмена</button>
				<button class="btn btn-primary" @click="saveRoom">Сохранить</button>
			</template>
		</Modal>
	</div>
</template>

<style scoped>
.tab-bar {
	display: flex;
	gap: 4px;
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	padding: 4px;
	flex-wrap: wrap;
}
.tab-btn {
	border: none;
	background: transparent;
	color: var(--color-secondary);
	font: inherit;
	font-weight: 700;
	font-size: var(--font-size-sm);
	padding: var(--gap-sm) var(--gap-lg);
	border-radius: var(--radius-sm);
	cursor: pointer;
}
.tab-btn.active {
	background: var(--color-brand-highlight);
	color: var(--color-brand);
}
.li {
	display: flex;
	gap: var(--gap-sm);
	align-items: center;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
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
.chip.pick {
	cursor: pointer;
	font-weight: var(--font-weight-medium);
}
.chip.pick.on {
	background: var(--color-brand-highlight);
	border-color: var(--color-brand);
	color: var(--color-brand);
}
</style>
