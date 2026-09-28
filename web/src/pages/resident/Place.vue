<script setup>
/**
 * «Жильё» — всё о том, где живёт вахтовик, на одной странице (раньше было разнесено
 * по вкладкам «Номер» и «Дом»). Сверху — закреплённые кнопки разделов, подсвечивается тот,
 * который сейчас на экране.
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue"
import { useRouter, useRoute } from "vue-router"
import { api, post } from "@/api/client"
import { toast } from "@/toast"
import { useOverview } from "@/api/me"
import { amenityIcon, placeIcon } from "@/icons"
import Icon from "@/components/Icon.vue"
import Gallery from "@/components/Gallery.vue"
import Stars from "@/components/Stars.vue"
import MapView from "@/components/MapView.vue"
import FloorPlan from "@/components/FloorPlan.vue"
import { Avatar, Button, Textarea, EmptyState, Card } from "@/ui"

const router = useRouter()
const route = useRoute()
const { load } = useOverview()
const data = ref(null)
const plan = ref(null)
const loading = ref(true)

const pl = computed(() => data.value?.placement || null)
const room = computed(() => data.value?.room || null)
const hotel = computed(() => data.value?.hotel || null)
const mates = computed(() => data.value?.roommates || [])
const tel = (p) => "tel:" + String(p).replace(/[^\d+]/g, "")

/* ---------- разделы и подсветка текущего ---------- */
const SECTIONS = [
	{ id: "room", label: "Номер", icon: "bed" },
	{ id: "mates", label: "Соседи", icon: "users" },
	{ id: "floor", label: "Этаж", icon: "layout" },
	{ id: "house", label: "Дом", icon: "building" },
	{ id: "around", label: "Рядом", icon: "map-pin" },
	{ id: "feedback", label: "Отзывы", icon: "message-square" },
]
const current = ref("room")
const anchors = ref(null)
// После нажатия на кнопку подсветка стоит на выбранном, пока страница не доедет
let target = null
let releaseTimer = 0
function go(id, smooth = true) {
	current.value = id
	target = id
	clearTimeout(releaseTimer)
	releaseTimer = setTimeout(release, smooth ? 1200 : 50) // где нет события scrollend
	document.getElementById(id)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" })
}
function release() {
	target = null
	spy()
}
// Текущий раздел — последний, чей верх уже ушёл под полосу кнопок.
// У самого низа страницы — последний раздел: он не доезжает до верха.
function spy() {
	if (target || !anchors.value) return
	const line = anchors.value.getBoundingClientRect().bottom + 24
	let id = SECTIONS[0].id
	for (const sec of SECTIONS) {
		const el = document.getElementById(sec.id)
		if (el && el.getBoundingClientRect().top <= line) id = sec.id
	}
	if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) id = SECTIONS.at(-1).id
	current.value = id
}
// Активная кнопка всегда видна в полосе. Без плавности: вторая плавная прокрутка
// в Chrome обрывает первую — страница не доезжала бы до раздела.
watch(current, async () => {
	await nextTick()
	const nav = anchors.value
	const el = nav?.querySelector(".on")
	if (el) nav.scrollLeft = el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2
})
onMounted(async () => {
	window.addEventListener("scroll", spy, { passive: true })
	window.addEventListener("scrollend", release)
	try {
		;[data.value, plan.value] = await Promise.all([load(true), api("/me/plan").catch(() => null)])
		initReview()
	} finally {
		loading.value = false
	}
	// Переход со старых ссылок (/me/room → #room) и с главной
	const hash = route.hash?.slice(1)
	if (hash && SECTIONS.some((x) => x.id === hash)) setTimeout(() => go(hash, false), 300)
})
onUnmounted(() => {
	window.removeEventListener("scroll", spy)
	window.removeEventListener("scrollend", release)
	clearTimeout(releaseTimer)
})

/* ---------- удобства: нажал на сломанное → форма заявки ---------- */
function reportBroken(a) {
	router.push({ path: "/me/issues", query: { new: 1, amenity: a.name } })
}

/* ---------- план этажа ---------- */
const planRooms = computed(() =>
	(plan.value?.rooms || []).map((r) => ({ ...r, tone: "plain", highlight: r.id === plan.value.my_room_id, label: "№ " + r.number })),
)
const hasScheme = computed(() => !!(plan.value?.rooms?.length || plan.value?.shapes?.length))

/* ---------- рядом: карта и места ---------- */
const kindFilter = ref("")
const places = computed(() => hotel.value?.places || [])
const kinds = computed(() => [...new Set(places.value.map((p) => p.kind).filter(Boolean))])
const shownPlaces = computed(() => (kindFilter.value ? places.value.filter((p) => p.kind === kindFilter.value) : places.value))
const selectedMarkerId = ref("hotel")
const markers = computed(() => {
	const h = hotel.value
	if (!h) return []
	const out = []
	if (h.latitude && h.longitude)
		out.push({ id: "hotel", lat: h.latitude, lng: h.longitude, color: "#c78aff", shape: "home", title: `${h.name} — ваш дом`, html: `<b>${h.name}</b><br>Ваш дом` })
	for (const p of shownPlaces.value)
		if (p.latitude && p.longitude)
			out.push({ id: "place-" + p.id, lat: p.latitude, lng: p.longitude, color: "#4f9cff", title: p.name, html: `<b>${p.name}</b>${p.distance ? `<br>${p.distance}` : ""}` })
	return out
})
const selectedPlace = computed(() => places.value.find((p) => "place-" + p.id === String(selectedMarkerId.value)) || null)
const routeTarget = computed(() => selectedPlace.value || (hotel.value?.latitude ? hotel.value : null))
const openRoute = (app) => {
	const { latitude: lat, longitude: lng } = routeTarget.value
	window.open(app === "2gis" ? `https://2gis.ru/routeSearch/rsType/pedestrian/to/${lng},${lat}` : `https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=pd&z=16`, "_blank", "noopener")
}

/* ---------- отзывы: чужие (без имён) и своя оценка номера и дома ---------- */
const others = computed(() => data.value?.reviews || [])
const showAll = ref(false)
const shownOthers = computed(() => (showAll.value ? others.value : others.value.slice(0, 3)))
const monthYear = (d) => (d ? new Date(String(d).replace(" ", "T") + "Z").toLocaleDateString("ru-RU", { month: "long", year: "numeric" }) : "")
const rRoom = ref(0)
const tRoom = ref("")
const rHouse = ref(0)
const tHouse = ref("")
const saving = ref(false)
function initReview() {
	rRoom.value = data.value?.my_room_review?.rating || 0
	tRoom.value = data.value?.my_room_review?.text || ""
	rHouse.value = data.value?.my_review?.rating || 0
	tHouse.value = data.value?.my_review?.text || ""
}
async function sendReview() {
	if (!rRoom.value && !rHouse.value) return toast.error("Поставьте хотя бы одну оценку")
	saving.value = true
	try {
		if (rRoom.value) await post("/me/review", { target: "room", rating: rRoom.value, text: tRoom.value })
		if (rHouse.value) await post("/me/review", { target: "hotel", rating: rHouse.value, text: tHouse.value })
		data.value = await load(true)
		initReview()
		toast.success("Спасибо за отзыв!")
	} catch (e) {
		toast.error(e.message)
	} finally {
		saving.value = false
	}
}
const fmt = (d) => (d ? new Date(String(d).replace(" ", "T") + "Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "")
const short = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "")
</script>

<template>
	<div class="place-page">
		<div v-if="loading" class="res-skel"><span /><span /><span /></div>

		<Card v-else-if="!pl">
			<EmptyState icon="bed" title="Жильё пока не назначено" text="Как только комендант вас заселит, здесь появятся номер, соседи и всё о доме." />
		</Card>

		<template v-else>
			<!-- Закреплённые разделы страницы -->
			<nav ref="anchors" class="anchors" aria-label="Разделы">
				<button v-for="s in SECTIONS" :key="s.id" type="button" :class="{ on: current === s.id }" @click="go(s.id)">
					<Icon :name="s.icon" size="0.95rem" /> {{ s.label }}
				</button>
			</nav>

			<!-- НОМЕР -->
			<section id="room" class="sec k-rise">
				<div class="room-card">
					<div class="room-card__no">
						<b>№ {{ room.number }}</b>
						<span>{{ pl.bed_label }}</span>
					</div>
					<dl class="room-card__specs">
						<div><dt>Дом</dt><dd>{{ pl.hotel_name }}</dd></div>
						<div v-if="room.floor != null"><dt>Этаж</dt><dd>{{ room.floor }}</dd></div>
						<div v-if="room.class_name"><dt>Тип</dt><dd>{{ room.class_name }}</dd></div>
						<div><dt>Живёте</dt><dd>{{ short(pl.date_from) }} → {{ short(pl.date_to) }}</dd></div>
					</dl>
				</div>
				<p v-if="room.description" class="muted desc">{{ room.description }}</p>
				<Gallery v-if="room.images?.length" :images="room.images" />

				<div class="sec__head">
					<h3>Что в номере</h3>
					<span class="muted hint">нажмите на сломанное — отправим заявку</span>
				</div>
				<div v-if="room.amenities?.length" class="amen">
					<button v-for="a in room.amenities" :key="a.name" type="button" class="amen__item" @click="reportBroken(a)">
						<Icon :name="amenityIcon(a.icon)" size="1.3rem" />
						<span>{{ a.name }}</span>
						<Icon name="wrench" size="0.8rem" class="amen__fix" />
					</button>
				</div>
				<p v-else class="muted">Комендант ещё не отметил удобства номера.</p>
				<router-link v-if="room.open_issues" to="/me/issues" class="notice">
					<Icon name="wrench" /> По номеру открыто заявок: <b>{{ room.open_issues }}</b> — посмотреть
				</router-link>
			</section>

			<!-- СОСЕДИ -->
			<section id="mates" class="sec k-rise" style="--i: 1">
				<h2><Icon name="users" /> Соседи по комнате</h2>
				<p v-if="!mates.length" class="muted">Сейчас вы живёте в номере один.</p>
				<div v-else class="mates">
					<div v-for="r in mates" :key="r.id" class="mate">
						<Avatar :src="r.photo" :name="r.full_name" size="2.6rem" />
						<div class="grow">
							<div class="mate__name">{{ r.full_name }}</div>
							<div class="muted mate__sub">{{ [r.position, r.company].filter(Boolean).join(" · ") || "—" }} · {{ r.bed_label }}</div>
							<p v-if="r.about" class="mate__about">{{ r.about }}</p>
						</div>
						<a v-if="r.phone" :href="tel(r.phone)" class="call" title="Позвонить"><Icon name="phone" /></a>
					</div>
				</div>
			</section>

			<!-- ЭТАЖ -->
			<section id="floor" class="sec k-rise" style="--i: 2">
				<div class="sec__head">
					<h2><Icon name="layout" /> {{ plan?.floor ?? room.floor ?? 1 }} этаж</h2>
					<router-link v-if="plan?.available" to="/me/plan" class="more">крупнее <Icon name="chevron-right" size="0.9rem" /></router-link>
				</div>
				<template v-if="plan?.available">
					<FloorPlan v-if="hasScheme" :rooms="planRooms" :shapes="plan.shapes" />
					<img v-else-if="plan.image" :src="plan.image" alt="План этажа" class="floor-img" />
					<p class="muted hint"><span class="you" /> ваш номер · душевая, кухня, выход — на схеме</p>
				</template>
				<p v-else class="muted">Комендант ещё не нарисовал план этажа.</p>
			</section>

			<!-- ДОМ -->
			<section id="house" class="sec k-rise" style="--i: 3">
				<h2><Icon name="building" /> {{ hotel.name }}</h2>
				<p v-if="hotel.description" class="muted desc">{{ hotel.description }}</p>
				<div class="facts">
					<a v-if="hotel.phone" :href="tel(hotel.phone)" class="fact fact--link">
						<Icon name="phone" /><span><b>Комендант</b><span class="nowrap">{{ hotel.phone }}</span></span>
					</a>
					<div v-if="hotel.check_in || hotel.check_out" class="fact">
						<Icon name="clock" /><span><b>Заезд / выезд</b>{{ hotel.check_in || "—" }} / {{ hotel.check_out || "—" }}</span>
					</div>
					<div v-if="hotel.address || hotel.settlement" class="fact">
						<Icon name="map-pin" /><span><b>Адрес</b>{{ [hotel.settlement, hotel.address].filter(Boolean).join(", ") }}</span>
					</div>
					<a v-if="hotel.email" :href="`mailto:${hotel.email}`" class="fact fact--link">
						<Icon name="mail" /><span><b>E-mail</b>{{ hotel.email }}</span>
					</a>
				</div>
				<Gallery v-if="hotel.images?.length" :images="hotel.images" />

				<template v-if="hotel.amenities?.length">
					<h3>Что есть в доме</h3>
					<div class="tags">
						<span v-for="a in hotel.amenities" :key="a.name" class="tag"><Icon :name="amenityIcon(a.icon)" size="1.05rem" /> {{ a.name }}</span>
					</div>
				</template>

				<!-- Разделы коменданта: распорядок, телефоны и т.п. — ведутся в карточке дома -->
				<div v-for="s in hotel.info || []" :key="s.id" class="note">
					<div class="note__head"><Icon name="info" /> <b>{{ s.title }}</b><span class="note__from">от коменданта</span></div>
					<p>{{ s.body }}</p>
				</div>
				<div v-if="hotel.rules" class="note">
					<div class="note__head"><Icon name="book" /> <b>Правила проживания</b></div>
					<p>{{ hotel.rules }}</p>
				</div>
			</section>

			<!-- РЯДОМ -->
			<section id="around" class="sec k-rise" style="--i: 4">
				<h2><Icon name="map-pin" /> Что рядом</h2>
				<template v-if="markers.length || places.length">
					<div v-if="kinds.length > 1" class="chips">
						<button type="button" :class="{ on: !kindFilter }" @click="kindFilter = ''">Всё</button>
						<button v-for="k in kinds" :key="k" type="button" :class="{ on: kindFilter === k }" @click="kindFilter = k">{{ k }}</button>
					</div>
					<MapView v-if="markers.length" :markers="markers" :selected-id="selectedMarkerId" height="280px" @select="selectedMarkerId = $event" />
					<div v-if="routeTarget?.latitude" class="route">
						<span class="grow"><b>{{ selectedPlace ? selectedPlace.name : "Ваш дом" }}</b><span class="muted"> · маршрут пешком</span></span>
						<Button size="sm" icon="navigation" @click="openRoute('yandex')">Яндекс</Button>
						<Button size="sm" icon="navigation" @click="openRoute('2gis')">2ГИС</Button>
					</div>
					<div class="places">
						<button
							v-for="p in shownPlaces"
							:key="p.id"
							type="button"
							class="place"
							:class="{ on: selectedMarkerId === 'place-' + p.id }"
							@click="p.latitude && (selectedMarkerId = 'place-' + p.id)"
						>
							<span class="place__ic"><Icon :name="placeIcon(p.kind)" /></span>
							<span class="grow">
								<b>{{ p.name }}</b>
								<span class="muted">{{ [p.kind, p.distance].filter(Boolean).join(" · ") }}</span>
								<span v-if="p.note" class="muted place__note">{{ p.note }}</span>
							</span>
						</button>
					</div>
				</template>
				<p v-else class="muted">Комендант ещё не отметил, что есть рядом с домом.</p>
			</section>

			<!-- ОЦЕНКА -->
			<section id="feedback" class="sec k-rise" style="--i: 5">
				<h2><Icon name="message-square" /> Отзывы жильцов</h2>
				<div class="scores">
					<div>
						<span>Номер</span>
						<b v-if="room.rating"><Icon name="star" size="1rem" /> {{ room.rating }}</b><b v-else class="muted">—</b>
						<small>{{ room.reviews_count || 0 }} оцен.</small>
					</div>
					<div>
						<span>Дом</span>
						<b v-if="hotel.rating"><Icon name="star" size="1rem" /> {{ hotel.rating }}</b><b v-else class="muted">—</b>
						<small>{{ hotel.reviews_count || 0 }} оцен.</small>
					</div>
				</div>
				<p v-if="!others.length" class="muted">Другие жильцы пока ничего не написали — будьте первым.</p>
				<TransitionGroup v-else tag="div" name="rv" class="reviews">
					<article v-for="r in shownOthers" :key="r.id" class="rv">
						<div class="rv__head">
							<span class="rv__tag">{{ r.target === "room" ? "о номере" : "о доме" }}</span>
							<Stars :model-value="r.rating" readonly size="0.95rem" />
							<span class="muted rv__date">{{ monthYear(r.created_at) }}</span>
						</div>
						<p v-if="r.text">{{ r.text }}</p>
						<div v-if="r.reply" class="reply"><b>Комендант</b>{{ r.reply }}</div>
					</article>
				</TransitionGroup>
				<button v-if="others.length > 3" type="button" class="more-btn" @click="showAll = !showAll">
					{{ showAll ? "Свернуть" : `Показать все (${others.length})` }}
				</button>

				<h3>Ваша оценка</h3>
				<p class="muted hint">Отзыв увидят следующие жильцы — без вашего имени. Комендант ответит здесь же.</p>
				<div class="rate">
					<div class="rate__row">
						<b>Номер</b>
						<Stars v-model="rRoom" size="1.7rem" />
					</div>
					<Textarea v-if="rRoom" v-model="tRoom" :rows="2" placeholder="Что с номером: хорошо или что не так" />
					<div v-if="data.my_room_review?.reply" class="reply"><b>Комендант · {{ fmt(data.my_room_review.reply_at) }}</b>{{ data.my_room_review.reply }}</div>
				</div>
				<div class="rate">
					<div class="rate__row">
						<b>Дом</b>
						<Stars v-model="rHouse" size="1.7rem" />
					</div>
					<Textarea v-if="rHouse" v-model="tHouse" :rows="2" placeholder="Чистота, столовая, быт" />
					<div v-if="data.my_review?.reply" class="reply"><b>Комендант · {{ fmt(data.my_review.reply_at) }}</b>{{ data.my_review.reply }}</div>
				</div>
				<Button variant="primary" icon="check" :loading="saving" :disabled="!rRoom && !rHouse" @click="sendReview">
					{{ data.my_room_review || data.my_review ? "Обновить оценку" : "Отправить отзыв" }}
				</Button>
			</section>
		</template>
	</div>
</template>

<style scoped>
.place-page {
	display: grid;
	/* иначе карта/схема с фиксированной шириной раздувают колонку шире экрана */
	grid-template-columns: minmax(0, 1fr);
	gap: var(--gap-xl);
}
/* Закреплённые разделы */
.anchors {
	position: sticky;
	top: var(--res-top-h, 3.6rem);
	z-index: 5;
	display: flex;
	gap: 6px;
	margin: calc(-1 * var(--gap-sm)) calc(-1 * var(--gap-md)) 0;
	padding: var(--gap-sm) var(--gap-md);
	overflow-x: auto;
	scrollbar-width: none;
	background: var(--color-bg);
	border-bottom: 1px solid var(--color-divider);
	backdrop-filter: blur(10px);
	-webkit-backdrop-filter: blur(10px);
}
.anchors button {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	flex-shrink: 0;
	padding: 7px 12px;
	border-radius: 999px;
	border: 1px solid var(--color-divider);
	background: var(--color-raised-bg);
	color: var(--color-secondary);
	font: inherit;
	font-size: var(--font-size-sm);
	font-weight: var(--font-weight-bold);
	cursor: pointer;
	transition: background var(--speed), color var(--speed), border-color var(--speed);
}
.anchors button.on {
	background: var(--color-brand);
	border-color: var(--color-brand);
	color: var(--color-accent-contrast);
}
.sec {
	display: grid;
	gap: var(--gap-md);
	grid-template-columns: minmax(0, 1fr);
	scroll-margin-top: calc(var(--res-top-h, 3.6rem) + 3.6rem);
}
.sec h2 {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	font-size: var(--font-size-lg);
}
.sec h2 :deep(svg) {
	color: var(--color-brand);
}
.sec h3 {
	font-size: var(--font-size-nm);
	margin-top: var(--gap-xs);
}
.sec p {
	margin: 0;
}
.sec__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--gap-md);
	flex-wrap: wrap;
}
.hint {
	font-size: var(--font-size-xs);
}
.desc {
	font-size: var(--font-size-sm);
}
.more {
	display: inline-flex;
	align-items: center;
	font-size: var(--font-size-sm);
	font-weight: var(--font-weight-bold);
}
.grow {
	flex: 1;
	min-width: 0;
}

/* Номер */
.room-card {
	display: flex;
	align-items: center;
	gap: var(--gap-lg);
	flex-wrap: wrap;
	padding: var(--gap-lg);
	border-radius: var(--radius-xl);
	border: 1px solid color-mix(in srgb, var(--color-brand) 30%, var(--color-divider));
	background: radial-gradient(420px 200px at 0% 0%, color-mix(in srgb, var(--color-brand) 20%, transparent), transparent 70%), var(--color-raised-bg);
}
.room-card__no {
	display: grid;
	place-items: center;
	padding: var(--gap-md) var(--gap-lg);
	border-radius: var(--radius-lg);
	background: var(--color-brand-highlight);
	min-width: 7.5rem;
}
.room-card__no b {
	font-size: 2rem;
	line-height: 1.05;
	color: var(--color-brand);
	white-space: nowrap;
}
.room-card__no span {
	font-size: var(--font-size-sm);
	color: var(--color-secondary);
}
.room-card__specs {
	flex: 1;
	min-width: 12rem;
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
	gap: var(--gap-sm) var(--gap-md);
	margin: 0;
}
.room-card__specs dt {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.room-card__specs dd {
	margin: 1px 0 0;
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
}
.amen {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
	gap: var(--gap-sm);
}
.amen__item {
	position: relative;
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-md);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-divider);
	background: var(--color-raised-bg);
	color: var(--color-contrast);
	font: inherit;
	font-weight: var(--font-weight-bold);
	font-size: var(--font-size-sm);
	text-align: left;
	cursor: pointer;
	transition: border-color var(--speed-fast), transform var(--speed-fast);
}
.amen__item :deep(svg:first-child) {
	color: var(--color-brand);
}
.amen__item:hover {
	border-color: var(--color-orange);
}
.amen__item:active {
	transform: scale(0.97);
}
.amen__fix {
	margin-left: auto;
	color: var(--color-orange);
	opacity: 0.7;
}
.notice {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-orange-bg);
	color: var(--color-orange);
	font-size: var(--font-size-sm);
}

/* Соседи */
.mates {
	display: grid;
	gap: var(--gap-sm);
}
.mate {
	display: flex;
	align-items: flex-start;
	gap: var(--gap-md);
	padding: var(--gap-md);
	border-radius: var(--radius-lg);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
}
.mate__name {
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
}
.mate__sub {
	font-size: var(--font-size-xs);
}
.mate__about {
	margin-top: 4px !important;
	font-size: var(--font-size-sm);
}
.call {
	display: grid;
	place-items: center;
	width: 2.6rem;
	height: 2.6rem;
	border-radius: 50%;
	background: var(--color-green-bg);
	color: var(--color-green);
	flex-shrink: 0;
}

/* Этаж */
.floor-img {
	width: 100%;
	border-radius: var(--radius-md);
	background: #fff;
}
.you {
	display: inline-block;
	width: 12px;
	height: 12px;
	border-radius: 3px;
	border: 2px solid var(--color-brand);
	background: color-mix(in srgb, var(--color-brand), transparent 55%);
	vertical-align: -1px;
}

/* Дом */
.facts {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: var(--gap-sm);
}
.fact {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	color: var(--color-base);
	font-size: var(--font-size-sm);
}
.fact--link:hover {
	border-color: var(--color-brand);
}
.fact :deep(svg) {
	color: var(--color-brand);
	flex-shrink: 0;
}
.fact b {
	display: block;
	font-size: var(--font-size-xs);
	color: var(--color-contrast);
}
.tags {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
.tag {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 6px 12px;
	border-radius: 999px;
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	font-size: var(--font-size-sm);
}
.tag :deep(svg) {
	color: var(--color-brand);
}
.note {
	padding: var(--gap-md) var(--gap-lg);
	border-radius: var(--radius-lg);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
}
.note__head {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	margin-bottom: 6px;
}
.note__head :deep(svg) {
	color: var(--color-brand);
}
.note__head b {
	color: var(--color-contrast);
}
.note__from {
	margin-left: auto;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.note p {
	white-space: pre-line;
	font-size: var(--font-size-sm);
	line-height: 1.6;
}

/* Рядом */
.chips {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
}
.chips button {
	padding: 6px 12px;
	border-radius: 999px;
	border: 1px solid var(--color-divider);
	background: transparent;
	color: var(--color-secondary);
	font: inherit;
	font-size: var(--font-size-sm);
	font-weight: var(--font-weight-bold);
	cursor: pointer;
}
.chips button.on {
	border-color: var(--color-brand);
	color: var(--color-brand);
	background: var(--color-brand-highlight);
}
.route {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	font-size: var(--font-size-sm);
}
.places {
	display: grid;
	gap: 6px;
}
.place {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-divider);
	background: var(--color-raised-bg);
	color: var(--color-base);
	font: inherit;
	text-align: left;
	cursor: pointer;
}
.place.on {
	border-color: var(--color-brand);
}
.place .grow {
	display: grid;
	font-size: var(--font-size-sm);
}
.place b {
	color: var(--color-contrast);
}
.place__note {
	font-size: var(--font-size-xs);
}
.place__ic {
	display: grid;
	place-items: center;
	width: 2.2rem;
	height: 2.2rem;
	border-radius: var(--radius-md);
	background: var(--color-blue-bg);
	color: var(--color-blue);
	flex-shrink: 0;
}

/* Оценка */
.scores {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-sm);
}
.scores div {
	display: grid;
	padding: var(--gap-md);
	border-radius: var(--radius-lg);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
}
.scores span,
.scores small {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.scores b {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 1.5rem;
	color: var(--color-contrast);
}
.scores b :deep(svg) {
	color: #f5b301;
	fill: currentColor;
}
.reviews {
	display: grid;
	gap: var(--gap-sm);
}
.rv {
	display: grid;
	gap: 6px;
	padding: var(--gap-md) var(--gap-lg);
	border-radius: var(--radius-lg);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	font-size: var(--font-size-sm);
}
.rv__head {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	flex-wrap: wrap;
}
.rv__tag {
	padding: 1px 8px;
	border-radius: 999px;
	background: var(--color-button-bg);
	font-size: var(--font-size-xs);
	font-weight: var(--font-weight-bold);
}
.rv__date {
	margin-left: auto;
	font-size: var(--font-size-xs);
}
.rv-enter-active {
	transition: opacity 240ms ease, transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.rv-enter-from {
	opacity: 0;
	transform: translateY(6px);
}
.more-btn {
	justify-self: start;
	padding: 0;
	border: none;
	background: none;
	color: var(--color-brand);
	font: inherit;
	font-size: var(--font-size-sm);
	font-weight: var(--font-weight-bold);
	cursor: pointer;
}
.rate {
	display: grid;
	gap: var(--gap-sm);
	padding: var(--gap-md) var(--gap-lg);
	border-radius: var(--radius-lg);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
}
.rate__row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--gap-md);
}
.rate__row b {
	color: var(--color-contrast);
}
.reply {
	display: grid;
	gap: 2px;
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-brand-highlight);
	font-size: var(--font-size-sm);
}
.reply b {
	font-size: var(--font-size-xs);
	color: var(--color-brand);
}
</style>
