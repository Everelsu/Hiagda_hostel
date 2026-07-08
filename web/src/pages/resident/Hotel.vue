<script setup>
import { ref, onMounted } from "vue"
import { post } from "@/api/client"
import { toast } from "@/toast"
import { computed } from "vue"
import { useOverview } from "@/api/me"
import { amenityIcon, placeIcon } from "@/icons"
import Icon from "@/components/Icon.vue"
import Gallery from "@/components/Gallery.vue"
import Stars from "@/components/Stars.vue"
import MapView from "@/components/MapView.vue"
import { PageHeader, Button } from "@/ui"

const { load } = useOverview()
const data = ref(null)
const myRating = ref(0)
const myText = ref("")

const mapMarkers = computed(() => {
	const h = data.value?.hotel
	if (!h) return []
	const out = []
	if (h.latitude && h.longitude) out.push({ id: "hotel", lat: h.latitude, lng: h.longitude, color: "#c78aff", html: `<b>${h.name}</b>` })
	for (const p of h.places || []) {
		if (p.latitude && p.longitude) out.push({ id: "place-" + p.id, lat: p.latitude, lng: p.longitude, color: "#4f9cff", title: p.name })
	}
	return out
})
function fmt(d) {
	return d ? new Date(d.replace(" ", "T") + "Z").toLocaleDateString("ru-RU", { dateStyle: "medium" }) : ""
}

async function refresh() {
	data.value = await load(true)
	myRating.value = data.value.my_review?.rating || 0
	myText.value = data.value.my_review?.text || ""
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
		<PageHeader title="О доме и посёлке" icon="building" :back="'/me'" />

		<div v-if="!data.hotel" class="card"><p class="muted">Нет данных.</p></div>
		<template v-else>
			<Gallery v-if="data.hotel.images?.length" :images="data.hotel.images" />

			<div class="card">
				<div class="spread">
					<div class="section-title" style="margin: 0">{{ data.hotel.name }}</div>
					<div v-if="data.hotel.rating" class="row" style="gap: 6px"><Stars :model-value="data.hotel.rating" readonly /> <b>{{ data.hotel.rating }}</b> <span class="muted">({{ data.hotel.reviews_count }})</span></div>
				</div>
				<p v-if="data.hotel.description" style="margin-top: var(--gap-sm)">{{ data.hotel.description }}</p>
				<div class="grid" style="gap: var(--gap-xs); margin-top: var(--gap-sm)">
					<div v-if="data.hotel.settlement" class="spread"><span class="muted">Посёлок</span> <b>{{ data.hotel.settlement }}</b></div>
					<div v-if="data.hotel.address" class="spread">
						<span class="muted">Адрес</span>
						<b>{{ data.hotel.address }}
							<a v-if="data.hotel.latitude && data.hotel.longitude" :href="`https://yandex.ru/maps/?pt=${data.hotel.longitude},${data.hotel.latitude}&z=16&l=map`" target="_blank" rel="noopener" style="margin-left: 6px"><Icon name="map-pin" /> карта</a>
						</b>
					</div>
					<div v-if="data.hotel.phone" class="spread"><span class="muted">Комендант</span> <b>{{ data.hotel.phone }}</b></div>
					<div v-if="data.hotel.email" class="spread"><span class="muted">E-mail</span> <b>{{ data.hotel.email }}</b></div>
					<div v-if="data.hotel.check_in || data.hotel.check_out" class="spread"><span class="muted">Заезд / выезд</span> <b>{{ data.hotel.check_in || "—" }} / {{ data.hotel.check_out || "—" }}</b></div>
				</div>
				<div v-if="data.hotel.amenities?.length" class="amenities" style="margin-top: var(--gap-md)">
					<span v-for="a in data.hotel.amenities" :key="a.name" class="chip amenity"><Icon :name="amenityIcon(a.icon)" /> {{ a.name }}</span>
				</div>
			</div>

			<div v-if="mapMarkers.length" class="card">
				<div class="section-title"><Icon name="map-pin" /> На карте</div>
				<MapView :markers="mapMarkers" height="300px" />
			</div>

			<div v-if="data.hotel.places?.length" class="card">
				<div class="section-title">Что рядом</div>
				<div class="grid" style="gap: var(--gap-sm)">
					<div v-for="p in data.hotel.places" :key="p.id" class="place">
						<span class="place-ico"><Icon :name="placeIcon(p.kind)" size="1.3rem" /></span>
						<div class="grow">
							<div class="contrast" style="font-weight: 700">{{ p.name }} <span v-if="p.distance" class="muted" style="font-weight: 400">· {{ p.distance }}</span></div>
							<div v-if="p.note" class="muted" style="font-size: var(--font-size-sm)">{{ p.note }}</div>
						</div>
					</div>
				</div>
			</div>

			<div v-for="s in data.hotel.info || []" :key="s.id" class="card">
				<div class="section-title">{{ s.title }}</div>
				<p style="margin: 0; white-space: pre-line">{{ s.body }}</p>
			</div>

			<div v-if="data.hotel.rules" class="card">
				<div class="section-title">Правила</div>
				<p class="muted" style="margin: 0; white-space: pre-line">{{ data.hotel.rules }}</p>
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
.amenities {
	display: flex;
	flex-wrap: wrap;
	gap: var(--gap-sm);
}
.amenity {
	font-weight: var(--font-weight-medium);
	font-size: var(--font-size-sm);
}
.place {
	display: flex;
	gap: var(--gap-md);
	align-items: center;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.place-ico {
	font-size: 1.4rem;
}
.reply {
	margin-top: var(--gap-md);
	padding: var(--gap-md);
	background: var(--color-brand-highlight);
	border-radius: var(--radius-md);
}
</style>
