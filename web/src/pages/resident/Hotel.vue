<script setup>
import { ref, onMounted, computed } from "vue"
import { post } from "@/api/client"
import { toast } from "@/toast"
import { useOverview } from "@/api/me"
import { amenityIcon, placeIcon } from "@/icons"
import Icon from "@/components/Icon.vue"
import Gallery from "@/components/Gallery.vue"
import Stars from "@/components/Stars.vue"
import MapView from "@/components/MapView.vue"
import { PageHeader, Button, Chip } from "@/ui"

const { load } = useOverview()
const data = ref(null)
const myRating = ref(0)
const myText = ref("")
const selectedMarkerId = ref("hotel")

const hotel = computed(() => data.value?.hotel)
const mapMarkers = computed(() => {
	const h = hotel.value
	if (!h) return []
	const out = []
	if (h.latitude && h.longitude) {
		out.push({
			id: "hotel",
			lat: h.latitude,
			lng: h.longitude,
			color: "#c78aff",
			title: h.name,
			html: `<b>${h.name}</b><br>${h.address || h.settlement || "Ваш дом"}`,
		})
	}
	for (const p of h.places || []) {
		if (p.latitude && p.longitude) {
			out.push({
				id: "place-" + p.id,
				lat: p.latitude,
				lng: p.longitude,
				color: "#4f9cff",
				title: p.name,
				html: `<b>${p.name}</b><br>${p.distance || ""}${p.note ? `<br>${p.note}` : ""}`,
			})
		}
	}
	return out
})
const hasMap = computed(() => mapMarkers.value.length > 0)

function fmt(d) {
	return d ? new Date(d.replace(" ", "T") + "Z").toLocaleDateString("ru-RU", { dateStyle: "medium" }) : ""
}
function openYandex(lat, lng) {
	window.open(`https://yandex.ru/maps/?pt=${lng},${lat}&z=16&l=map`, "_blank", "noopener")
}
function selectPlace(place) {
	if (place.latitude && place.longitude) selectedMarkerId.value = "place-" + place.id
}

async function refresh() {
	data.value = await load(true)
	myRating.value = data.value.my_review?.rating || 0
	myText.value = data.value.my_review?.text || ""
	selectedMarkerId.value = mapMarkers.value[0]?.id || "hotel"
}
onMounted(refresh)

async function submitReview() {
	if (!myRating.value) return toast("Поставьте оценку")
	try {
		await post("/me/review", { rating: myRating.value, text: myText.value })
		await refresh()
		toast("Спасибо за отзыв!")
	} catch (e) {
		toast(e.message)
	}
}
</script>

<template>
	<div class="grid" v-if="data">
		<PageHeader title="Дом и посёлок" icon="building" :back="'/me'" />

		<div v-if="!hotel" class="card"><p class="muted">Нет данных.</p></div>
		<template v-else>
			<Gallery v-if="hotel.images?.length" :images="hotel.images" />

			<div class="card hero-card">
				<div class="spread hero-head">
					<div>
						<div class="section-title" style="margin: 0">{{ hotel.name }}</div>
						<p v-if="hotel.description" class="muted hero-desc">{{ hotel.description }}</p>
					</div>
					<div v-if="hotel.rating" class="row rating"><Stars :model-value="hotel.rating" readonly /> <b>{{ hotel.rating }}</b> <span class="muted">({{ hotel.reviews_count }})</span></div>
				</div>
				<div class="info-grid">
					<div v-if="hotel.settlement" class="info-item"><span>Посёлок</span><b>{{ hotel.settlement }}</b></div>
					<div v-if="hotel.address" class="info-item">
						<span>Адрес</span>
						<b>{{ hotel.address }}</b>
					</div>
					<div v-if="hotel.phone" class="info-item"><span>Комендант</span><b>{{ hotel.phone }}</b></div>
					<div v-if="hotel.email" class="info-item"><span>E-mail</span><b>{{ hotel.email }}</b></div>
					<div v-if="hotel.check_in || hotel.check_out" class="info-item"><span>Заезд / выезд</span><b>{{ hotel.check_in || "—" }} / {{ hotel.check_out || "—" }}</b></div>
				</div>
				<div v-if="hotel.amenities?.length" class="amenities">
					<span v-for="a in hotel.amenities" :key="a.name" class="chip amenity"><Icon :name="amenityIcon(a.icon)" /> {{ a.name }}</span>
				</div>
			</div>

			<div v-if="hasMap" class="card map-section">
				<div class="spread">
					<div class="section-title"><Icon name="map-pin" /> На карте</div>
					<Button v-if="hotel.latitude && hotel.longitude" size="sm" icon="map-pin" @click="openYandex(hotel.latitude, hotel.longitude)">Открыть маршрут</Button>
				</div>
				<MapView :markers="mapMarkers" :selected-id="selectedMarkerId" height="320px" @select="selectedMarkerId = $event" />
			</div>

			<div v-if="hotel.places?.length" class="card">
				<div class="section-title">Что рядом</div>
				<div class="grid" style="gap: var(--gap-sm)">
					<button v-for="p in hotel.places" :key="p.id" type="button" class="place" :class="{ active: selectedMarkerId === 'place-' + p.id }" @click="selectPlace(p)">
						<span class="place-ico"><Icon :name="placeIcon(p.kind)" size="1.3rem" /></span>
						<span class="grow">
							<span class="contrast place-title">{{ p.name }}</span>
							<span v-if="p.distance" class="muted"> · {{ p.distance }}</span>
							<span v-if="p.note" class="muted place-note">{{ p.note }}</span>
						</span>
						<Chip v-if="p.latitude && p.longitude" color="#4f9cff" dot>карта</Chip>
					</button>
				</div>
			</div>

			<div v-for="s in hotel.info || []" :key="s.id" class="card">
				<div class="section-title">{{ s.title }}</div>
				<p style="margin: 0; white-space: pre-line">{{ s.body }}</p>
			</div>

			<div v-if="hotel.rules" class="card">
				<div class="section-title">Правила</div>
				<p class="muted" style="margin: 0; white-space: pre-line">{{ hotel.rules }}</p>
			</div>

			<div class="card">
				<div class="section-title">{{ data.my_review ? "Мой отзыв" : "Оставить отзыв о доме" }}</div>
				<div class="field"><label>Оценка</label><Stars v-model="myRating" size="1.8rem" /></div>
				<div class="field"><label>Комментарий</label><textarea v-model="myText" rows="3" placeholder="Что понравилось, что улучшить" /></div>
				<Button variant="primary" @click="submitReview">{{ data.my_review ? "Обновить отзыв" : "Отправить" }}</Button>

				<div v-if="data.my_review?.reply" class="reply">
					<div class="row" style="gap: var(--gap-sm)"><Icon name="message-square" style="color: var(--color-brand)" /> <b class="contrast">Ответ администрации</b> <span class="muted" style="font-size: var(--font-size-xs)">{{ fmt(data.my_review.reply_at) }}</span></div>
					<p style="margin: var(--gap-xs) 0 0; white-space: pre-wrap">{{ data.my_review.reply }}</p>
				</div>
			</div>
		</template>
	</div>
</template>

<style scoped>
.back {
	font-weight: 700;
	color: var(--color-secondary);
}
.hero-card {
	background: var(--brand-gradient-bg), var(--color-raised-bg);
}
.hero-head {
	align-items: flex-start;
}
.hero-desc {
	margin: var(--gap-sm) 0 0;
}
.rating {
	gap: 6px;
	white-space: nowrap;
}
.info-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	gap: var(--gap-sm);
	margin-top: var(--gap-md);
}
.info-item {
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.info-item span {
	display: block;
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
}
.info-item b {
	color: var(--color-contrast);
}
.amenities {
	display: flex;
	flex-wrap: wrap;
	gap: var(--gap-sm);
	margin-top: var(--gap-md);
}
.amenity {
	font-weight: var(--font-weight-medium);
	font-size: var(--font-size-sm);
}
.map-section .section-title {
	margin: 0;
}
.place {
	display: flex;
	gap: var(--gap-md);
	align-items: center;
	width: 100%;
	text-align: left;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	color: var(--color-base);
	border-radius: var(--radius-md);
	cursor: pointer;
	font: inherit;
}
.place:hover,
.place.active {
	border-color: var(--color-brand);
	background: var(--color-brand-highlight);
}
.place-ico {
	font-size: 1.4rem;
	color: var(--color-brand);
}
.place-title {
	font-weight: 700;
}
.place-note {
	display: block;
	font-size: var(--font-size-sm);
}
.reply {
	margin-top: var(--gap-md);
	padding: var(--gap-md);
	background: var(--color-brand-highlight);
	border-radius: var(--radius-md);
}
@media (max-width: 760px) {
	.hero-head,
	.map-section .spread {
		align-items: flex-start;
		flex-direction: column;
	}
}
</style>
