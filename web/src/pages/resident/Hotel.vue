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
import { PageHeader, Card, Button, Tabs, Textarea, EmptyState } from "@/ui"

const { load } = useOverview()
const data = ref(null)
const loading = ref(true)
const tab = ref("house")
const myRating = ref(0)
const myText = ref("")
const selectedMarkerId = ref("hotel")
const kindFilter = ref("")

const hotel = computed(() => data.value?.hotel)

const tabs = [
	{ value: "house", label: "Дом", icon: "building" },
	{ value: "around", label: "Посёлок", icon: "map-pin" },
	{ value: "review", label: "Отзыв", icon: "message-square" },
]

/* ---------- карта: дом + точки вокруг, связка «список ⇄ карта» ---------- */
const places = computed(() => hotel.value?.places || [])
const kinds = computed(() => [...new Set(places.value.map((p) => p.kind).filter(Boolean))])
const shownPlaces = computed(() => (kindFilter.value ? places.value.filter((p) => p.kind === kindFilter.value) : places.value))

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
			shape: "home",
			title: `${h.name} — ваш дом`,
			html: `<b>${h.name}</b><br>Ваш дом<br>${h.address || h.settlement || ""}`,
		})
	}
	for (const p of shownPlaces.value) {
		if (p.latitude && p.longitude) {
			out.push({
				id: "place-" + p.id,
				lat: p.latitude,
				lng: p.longitude,
				color: "#4f9cff",
				title: p.name,
				html: `<b>${p.name}</b>${p.distance ? `<br>${p.distance}` : ""}${p.note ? `<br>${p.note}` : ""}`,
			})
		}
	}
	return out
})
const hasMap = computed(() => mapMarkers.value.length > 0)
const selectedPlace = computed(() => {
	const id = String(selectedMarkerId.value || "")
	if (!id.startsWith("place-")) return null
	return places.value.find((p) => "place-" + p.id === id) || null
})

function selectPlace(place) {
	selectedMarkerId.value = place.latitude && place.longitude ? "place-" + place.id : selectedMarkerId.value
}
function routeYandex(lat, lng) {
	window.open(`https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=pd&z=16`, "_blank", "noopener")
}
function route2gis(lat, lng) {
	window.open(`https://2gis.ru/routeSearch/rsType/pedestrian/to/${lng},${lat}`, "_blank", "noopener")
}
const routeTarget = computed(() => selectedPlace.value || (hotel.value?.latitude ? hotel.value : null))

async function refresh(force = false) {
	data.value = await load(force)
	myRating.value = data.value.my_review?.rating || 0
	myText.value = data.value.my_review?.text || ""
	if (!mapMarkers.value.some((m) => m.id === selectedMarkerId.value)) {
		selectedMarkerId.value = mapMarkers.value[0]?.id || "hotel"
	}
}
onMounted(async () => {
	try {
		await refresh()
	} finally {
		loading.value = false
	}
})

async function submitReview() {
	if (!myRating.value) return toast.error("Поставьте оценку")
	try {
		await post("/me/review", { target: "hotel", rating: myRating.value, text: myText.value })
		await refresh(true)
		toast.success("Спасибо за отзыв!")
	} catch (e) {
		toast.error(e.message)
	}
}
function fmt(d) {
	return d ? new Date(d.replace(" ", "T") + "Z").toLocaleDateString("ru-RU", { dateStyle: "medium" }) : ""
}
</script>

<template>
	<div class="grid">
		<PageHeader title="Дом и посёлок" icon="building" back="/me" />

		<Card v-if="loading"><EmptyState icon="building" text="Загрузка…" /></Card>
		<Card v-else-if="!hotel"><EmptyState icon="building" title="Нет данных" text="Дом не назначен — обратитесь к коменданту." /></Card>

		<template v-else>
			<Tabs v-model="tab" :options="tabs" />

			<!-- ДОМ -->
			<template v-if="tab === 'house'">
				<section class="house-head">
					<div>
						<h2 class="house-name">{{ hotel.name }}</h2>
						<p v-if="hotel.description" class="muted house-desc">{{ hotel.description }}</p>
					</div>
					<div v-if="hotel.rating" class="rating"><Stars :model-value="hotel.rating" readonly /> <b>{{ hotel.rating }}</b> <span class="muted">({{ hotel.reviews_count }})</span></div>
				</section>

				<Gallery v-if="hotel.images?.length" :images="hotel.images" />

				<!-- Контакты: звонок в один тап -->
				<section class="facts">
					<a v-if="hotel.phone" :href="`tel:${hotel.phone}`" class="fact">
						<Icon name="phone" /><span><b>Комендант</b><span class="nowrap">{{ hotel.phone }}</span></span>
					</a>
					<a v-if="hotel.email" :href="`mailto:${hotel.email}`" class="fact">
						<Icon name="mail" /><span><b>E-mail</b>{{ hotel.email }}</span>
					</a>
					<div v-if="hotel.check_in || hotel.check_out" class="fact">
						<Icon name="clock" /><span><b>Заезд / выезд</b>{{ hotel.check_in || "—" }} / {{ hotel.check_out || "—" }}</span>
					</div>
					<div v-if="hotel.address || hotel.settlement" class="fact">
						<Icon name="map-pin" /><span><b>Адрес</b>{{ [hotel.settlement, hotel.address].filter(Boolean).join(", ") }}</span>
					</div>
				</section>

				<section v-if="hotel.amenities?.length">
					<h3 class="sec"><Icon name="armchair" /> Что есть в доме</h3>
					<div class="amenities">
						<span v-for="a in hotel.amenities" :key="a.name" class="amenity">
							<Icon :name="amenityIcon(a.icon)" size="1.2rem" /> {{ a.name }}
						</span>
					</div>
				</section>

				<section v-for="s in hotel.info || []" :key="s.id">
					<h3 class="sec"><Icon name="info" /> {{ s.title }}</h3>
					<p class="text-block">{{ s.body }}</p>
				</section>

				<section v-if="hotel.rules">
					<h3 class="sec"><Icon name="book" /> Правила проживания</h3>
					<p class="text-block muted">{{ hotel.rules }}</p>
				</section>
			</template>

			<!-- ПОСЁЛОК -->
			<template v-else-if="tab === 'around'">
				<Card v-if="!hasMap && !places.length"><EmptyState icon="map-pin" title="Пока пусто" text="Комендант ещё не отметил объекты рядом с домом." /></Card>

				<template v-else>
					<div v-if="kinds.length > 1" class="chips">
						<button type="button" class="fchip" :class="{ on: !kindFilter }" @click="kindFilter = ''">Всё</button>
						<button v-for="k in kinds" :key="k" type="button" class="fchip" :class="{ on: kindFilter === k }" @click="kindFilter = k">{{ k }}</button>
					</div>

					<div v-if="hasMap" class="map-wrap">
						<MapView :markers="mapMarkers" :selected-id="selectedMarkerId" height="300px" @select="selectedMarkerId = $event" />
						<div class="map-foot">
							<div class="map-target">
								<Icon :name="selectedPlace ? placeIcon(selectedPlace.kind) : 'home'" />
								<span>
									<b class="contrast">{{ selectedPlace ? selectedPlace.name : hotel.name }}</b>
									<span class="muted">{{ selectedPlace ? selectedPlace.distance || selectedPlace.kind || "точка на карте" : "ваш дом" }}</span>
								</span>
							</div>
							<div v-if="routeTarget?.latitude" class="row" style="gap: var(--gap-xs)">
								<Button size="sm" icon="navigation" @click="route2gis(routeTarget.latitude, routeTarget.longitude)">2ГИС</Button>
								<Button size="sm" icon="navigation" @click="routeYandex(routeTarget.latitude, routeTarget.longitude)">Яндекс</Button>
							</div>
						</div>
					</div>

					<section v-if="shownPlaces.length">
						<h3 class="sec"><Icon name="map-pin" /> Что рядом</h3>
						<div class="places">
							<button
								v-for="p in shownPlaces"
								:key="p.id"
								type="button"
								class="place"
								:class="{ active: selectedMarkerId === 'place-' + p.id }"
								@click="selectPlace(p)"
							>
								<span class="place-ico"><Icon :name="placeIcon(p.kind)" size="1.2rem" /></span>
								<span class="grow">
									<span class="place-title">{{ p.name }}</span>
									<span class="muted place-sub">
										{{ [p.kind, p.distance].filter(Boolean).join(" · ") || "рядом с домом" }}
									</span>
									<span v-if="p.note" class="muted place-note">{{ p.note }}</span>
								</span>
								<Icon v-if="p.latitude && p.longitude" name="map-pin" size="0.9rem" class="place-flag" />
							</button>
						</div>
					</section>
				</template>
			</template>

			<!-- ОТЗЫВ О ДОМЕ -->
			<template v-else>
				<Card stack>
					<h3 class="sec" style="margin: 0">{{ data.my_review ? "Мой отзыв о доме" : "Оценить дом" }}</h3>
					<p class="muted review-hint">Это отзыв о доме целиком: чистота, столовая, бытовые условия. Оценка своего номера — на вкладке «Мой номер».</p>
					<Stars v-model="myRating" size="1.8rem" />
					<Textarea v-model="myText" :rows="3" placeholder="Что понравилось, что улучшить" />
					<Button variant="primary" @click="submitReview">{{ data.my_review ? "Обновить отзыв" : "Отправить" }}</Button>

					<div v-if="data.my_review?.reply" class="reply">
						<div class="row" style="gap: var(--gap-sm)">
							<Icon name="message-square" style="color: var(--color-brand)" />
							<b class="contrast">Ответ администрации</b>
							<span class="muted" style="font-size: var(--font-size-xs)">{{ fmt(data.my_review.reply_at) }}</span>
						</div>
						<p class="reply-body">{{ data.my_review.reply }}</p>
					</div>
				</Card>
			</template>
		</template>
	</div>
</template>

<style scoped>
.house-head {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	gap: var(--gap-md);
	flex-wrap: wrap;
}
.house-name {
	margin: 0;
	font-size: var(--font-size-xl);
	color: var(--color-contrast);
}
.house-desc {
	margin: var(--gap-xs) 0 0;
	font-size: var(--font-size-sm);
}
.rating {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	white-space: nowrap;
}
.facts {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	gap: var(--gap-sm);
}
.fact {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	color: var(--color-base);
	font-size: var(--font-size-sm);
}
a.fact:hover {
	border-color: var(--color-brand);
}
.fact :deep(svg) {
	color: var(--color-brand);
	flex-shrink: 0;
}
.fact b {
	display: block;
	color: var(--color-contrast);
	font-size: var(--font-size-xs);
}
.sec {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	margin: 0 0 var(--gap-sm);
	font-size: var(--font-size-md);
	color: var(--color-contrast);
}
.amenities {
	display: flex;
	flex-wrap: wrap;
	gap: var(--gap-sm);
}
.amenity {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: var(--gap-xs) var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-max);
	font-size: var(--font-size-sm);
}
.amenity :deep(svg) {
	color: var(--color-brand);
}
.text-block {
	margin: 0;
	white-space: pre-line;
	padding: var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	font-size: var(--font-size-sm);
}
.chips {
	display: flex;
	gap: var(--gap-xs);
	flex-wrap: wrap;
}
.fchip {
	padding: var(--gap-xs) var(--gap-md);
	font: inherit;
	font-size: var(--font-size-sm);
	font-weight: 600;
	cursor: pointer;
	color: var(--color-secondary);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-max);
}
.fchip.on {
	background: var(--color-brand-highlight);
	border-color: var(--color-brand);
	color: var(--color-brand);
}
.map-wrap {
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	overflow: hidden;
	background: var(--color-raised-bg);
}
.map-wrap :deep(.noch-map) {
	border: none;
	border-radius: 0;
}
.map-foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--gap-sm);
	padding: var(--gap-sm) var(--gap-md);
	border-top: 1px solid var(--color-divider);
	flex-wrap: wrap;
}
.map-target {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	min-width: 0;
}
.map-target :deep(svg) {
	color: var(--color-brand);
	flex-shrink: 0;
}
.map-target b {
	display: block;
	font-size: var(--font-size-sm);
}
.map-target .muted {
	font-size: var(--font-size-xs);
}
.places {
	display: grid;
	gap: var(--gap-xs);
}
.place {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	width: 100%;
	text-align: left;
	font: inherit;
	cursor: pointer;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	color: var(--color-base);
}
.place:hover,
.place.active {
	border-color: var(--color-brand);
	background: var(--color-brand-highlight);
}
.place-ico {
	display: grid;
	place-items: center;
	width: 2rem;
	height: 2rem;
	border-radius: var(--radius-max);
	background: var(--color-bg);
	color: var(--color-brand);
	flex-shrink: 0;
}
.place-title {
	display: block;
	font-weight: 700;
	color: var(--color-contrast);
	font-size: var(--font-size-sm);
}
.place-sub,
.place-note {
	display: block;
	font-size: var(--font-size-xs);
}
.place-flag {
	color: var(--color-blue);
	flex-shrink: 0;
}
.review-hint {
	margin: 0;
	font-size: var(--font-size-sm);
}
.reply {
	margin-top: var(--gap-sm);
	padding: var(--gap-md);
	background: var(--color-brand-highlight);
	border-radius: var(--radius-md);
}
.reply-body {
	margin: var(--gap-xs) 0 0;
	white-space: pre-wrap;
}
</style>
