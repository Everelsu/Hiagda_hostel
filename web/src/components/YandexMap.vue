<script setup>
// Яндекс Карты (JavaScript API 2.1) с тем же интерфейсом, что и LeafletMap:
// метки с числом (badge), подписи, группировка близких домов, клик-выбор точки, «где я».
// Слои (схема / спутник / гибрид), полный экран, линейка и геолокация — штатные контролы Яндекса.
import { ref, onMounted, onBeforeUnmount, watch } from "vue"

const props = defineProps({
	markers: { type: Array, default: () => [] },
	center: { type: Array, default: () => [52.36, 115.51] },
	zoom: { type: Number, default: 12 },
	height: { type: String, default: "420px" },
	clickToPick: { type: Boolean, default: false },
	fit: { type: Boolean, default: true },
	selectedId: { type: [String, Number], default: null },
	cluster: Boolean,
})
const emit = defineEmits(["select", "pick", "located"])

const el = ref(null)
const wrap = ref(null)
// Свои компактные контролы вместо штатных Яндекса (как на второй карте)
const TYPES = { "yandex#map": "Схема", "yandex#satellite": "Спутник", "yandex#hybrid": "Гибрид" }
const type = ref("yandex#map")
const full = ref(false)
const locating = ref(false)
let ymaps = null
let map = null
let collection = null
let fitPending = true
const byId = new Map()

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

// Метка: кружок с числом или «капля», подпись справа (видна при приближении)
function pinHtml(m, selected) {
	const color = m.color || "#c78aff"
	const badge = m.badge != null && m.badge !== "" ? String(m.badge) : null
	const cls = ["ypin", badge ? "ypin--badge" : "", selected ? "ypin--sel" : "", m.shape === "home" ? "ypin--home" : ""].join(" ")
	const label = m.label ? `<em class="ypin__label">${esc(m.label)}</em>` : ""
	return `<div class="${cls}" style="--pin:${color}"><span>${badge ? `<i>${esc(badge)}</i>` : ""}</span>${label}</div>`
}

function render() {
	if (!map) return
	if (collection) map.geoObjects.remove(collection)
	byId.clear()
	const valid = props.markers.filter((m) => Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng)))

	collection = props.cluster
		? new ymaps.Clusterer({
				groupByCoordinates: false,
				gridSize: 80,
				clusterDisableClickZoom: false,
				clusterIconLayout: ymaps.templateLayoutFactory.createClass('<div class="ycluster"><b>{{ properties.sum }}</b><small>{{ properties.geoObjects.length }} дом.</small></div>', {
					build() {
						// Сумма свободных мест по домам группы — как на прежней карте
						const objs = this.getData().properties.get("geoObjects") || []
						this.getData().properties.set("sum", objs.reduce((s, o) => s + (Number(o.properties.get("badge")) || 0), 0), true)
						this.constructor.superclass.build.call(this)
					},
				}),
				clusterIconShape: { type: "Circle", coordinates: [28, 28], radius: 28 },
			})
		: new ymaps.GeoObjectCollection()

	for (const m of valid) {
		const selected = String(m.id) === String(props.selectedId)
		const size = m.badge != null ? (selected ? 42 : 36) : selected ? 30 : 24
		const pm = new ymaps.Placemark(
			[Number(m.lat), Number(m.lng)],
			{ badge: m.badge, hintContent: m.title || m.label || "", balloonContent: m.html || "" },
			{
				iconLayout: ymaps.templateLayoutFactory.createClass(pinHtml(m, selected)),
				iconShape: { type: "Circle", coordinates: [0, -size / 2], radius: size / 2 },
				iconOffset: [-size / 2, -size],
				zIndex: selected ? 1000 : m.shape === "home" ? 500 : 0,
				hasBalloon: !!m.html,
				openBalloonOnClick: !!m.html,
			},
		)
		pm.events.add("click", () => emit("select", m.id))
		byId.set(String(m.id), pm)
		collection.add(pm)
	}
	map.geoObjects.add(collection)

	if (fitPending && props.fit && valid.length) {
		fitPending = false
		if (valid.length === 1) map.setCenter([Number(valid[0].lat), Number(valid[0].lng)], Math.max(map.getZoom(), 14))
		else map.setBounds(collection.getBounds(), { checkZoomRange: true, zoomMargin: 50 }).then(() => map.getZoom() > 15 && map.setZoom(15))
	}
	toggleLabels()
}
function toggleLabels() {
	el.value?.classList.toggle("ymap--labels", map.getZoom() >= 13)
}

function focusSelected() {
	const m = props.markers.find((x) => String(x.id) === String(props.selectedId))
	if (!map || !m) return
	map.setCenter([Number(m.lat), Number(m.lng)], Math.max(map.getZoom(), props.cluster ? 16 : 14), { duration: 300 })
}

function setType(t) {
	type.value = t
	map?.setType(t)
	syncType()
	try {
		localStorage.setItem("ymap_type", t)
	} catch {}
}
const zoomBy = (d) => map?.setZoom(map.getZoom() + d, { duration: 200 })
function toggleFull() {
	if (document.fullscreenElement) document.exitFullscreen()
	else wrap.value?.requestFullscreen?.()
}
function onFs() {
	full.value = document.fullscreenElement === wrap.value
	setTimeout(() => map?.container.fitToViewport(), 100)
}
function locate() {
	locating.value = true
	ymaps.geolocation
		.get({ provider: "browser", mapStateAutoApply: true })
		.then((res) => {
			const [lat, lng] = res.geoObjects.get(0).geometry.getCoordinates()
			res.geoObjects.options.set("preset", "islands#blueCircleIcon")
			map.geoObjects.add(res.geoObjects)
			map.setCenter([lat, lng], 16)
			emit("located", { lat, lng, accuracy: res.geoObjects.get(0).properties.get("accuracy") || 50 })
		})
		.catch(() => emit("located", { error: "Не удалось определить местоположение. Геолокация работает только по HTTPS." }))
		.finally(() => (locating.value = false))
}
defineExpose({ locate, flyTo: (lat, lng, z = 16) => map?.setCenter([lat, lng], z, { duration: 400 }) })

// Тёмная тема: приглушаем только «схему», спутник и гибрид оставляем как есть
function syncType() {
	el.value?.classList.toggle("ymap--scheme", map.getType() === "yandex#map")
}

onMounted(async () => {
	ymaps = window.ymaps
	map = new ymaps.Map(
		el.value,
		{
			center: props.center.map(Number),
			zoom: props.zoom,
			controls: [],
		},
		{ suppressMapOpenBlock: true, yandexMapDisablePoiInteractivity: true },
	)
	try {
		const t = localStorage.getItem("ymap_type")
		if (TYPES[t]) setType(t)
	} catch {}
	syncType()
	map.events.add("boundschange", toggleLabels)
	document.addEventListener("fullscreenchange", onFs)
	if (props.clickToPick) {
		map.events.add("click", (e) => {
			const [lat, lng] = e.get("coords")
			emit("pick", { lat, lng })
		})
	}
	render()
})

watch(
	() => props.markers,
	(now, before) => {
		if (!before || now.map((m) => m.id).join() !== before.map((m) => m.id).join()) fitPending = true
		render()
	},
	{ deep: true },
)
watch(
	() => props.selectedId,
	() => {
		render()
		focusSelected()
	},
)
watch(
	() => [props.center, props.zoom],
	() => {
		if (!map || props.fit) return
		const [lat, lng] = props.center.map(Number)
		if (Number.isFinite(lat) && Number.isFinite(lng)) map.setCenter([lat, lng], props.zoom)
	},
	{ deep: true },
)
onBeforeUnmount(() => {
	document.removeEventListener("fullscreenchange", onFs)
	map?.destroy()
	map = null
})
</script>

<template>
	<div ref="wrap" class="ymap-wrap" :class="{ full }">
		<div ref="el" class="ymap" :style="{ height: full ? '100vh' : height }" />
		<div class="noch-map__layers" role="group" aria-label="Подложка карты">
			<button v-for="(label, k) in TYPES" :key="k" type="button" :class="{ on: type === k }" @click="setType(k)">{{ label }}</button>
		</div>
		<div class="noch-map__tools ymap__tools">
			<button type="button" title="Приблизить" @click="zoomBy(1)">
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
			</button>
			<button type="button" title="Отдалить" @click="zoomBy(-1)">
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14" /></svg>
			</button>
			<button type="button" :title="locating ? 'Определяем…' : 'Где я'" :class="{ spin: locating }" @click="locate">
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" /></svg>
			</button>
			<button type="button" :title="full ? 'Свернуть' : 'Во весь экран'" @click="toggleFull">
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path v-if="!full" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><path v-else d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
			</button>
		</div>
	</div>
</template>

<style>
.ymap-wrap {
	position: relative;
}
.ymap-wrap.full {
	background: #000;
}
/* Колонка инструментов: сверху, у Яндекса нет своего зума */
.ymap__tools {
	top: 10px !important;
}
/* Промо «Открыть в Яндекс Картах» / «Создать свою карту» — лишний шум.
   Логотип и «Условия использования» оставляем: их прятать нельзя по условиям Яндекса. */
.ymap [class*="gotoymaps"],
.ymap [class*="gototech"],
.ymap [class*="map-copyrights-promo"] {
	display: none !important;
}
.ymap {
	/* свои слои Яндекса держим внутри: наши кнопки поверх */
	isolation: isolate;
	width: 100%;
	border-radius: var(--radius-lg);
	overflow: hidden;
	border: 1px solid var(--color-divider);
	background: var(--color-raised-bg);
}
:root[data-theme="dark"] .ymap--scheme [class*="ground-pane"] {
	filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.85) saturate(0.6);
}
.ypin {
	position: relative;
	display: inline-block;
	width: max-content;
}
.ypin span {
	display: block;
	width: 20px;
	height: 20px;
	background: var(--pin);
	border: 2px solid #fff;
	border-radius: 50% 50% 50% 0;
	transform: rotate(-45deg);
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}
.ypin--badge span {
	width: 34px;
	height: 34px;
	border-radius: 999px;
	transform: none;
	display: grid;
	place-items: center;
}
.ypin--badge.ypin--sel span {
	width: 40px;
	height: 40px;
	box-shadow: 0 0 0 6px color-mix(in srgb, var(--pin), transparent 70%), 0 6px 16px rgba(0, 0, 0, 0.5);
}
.ypin--home span {
	border-radius: 8px;
	transform: none;
	width: 26px;
	height: 26px;
}
.ypin i {
	font-style: normal;
	font-weight: 800;
	font-size: 13px;
	color: #10131a;
	font-family: Inter, system-ui, sans-serif;
}
.ypin__label {
	display: none;
	position: absolute;
	left: calc(100% + 6px);
	top: 50%;
	transform: translateY(-50%);
	padding: 2px 8px;
	border-radius: 999px;
	background: #1e2127;
	color: #fff;
	font: 700 12px Inter, system-ui, sans-serif;
	font-style: normal;
	white-space: nowrap;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
.ymap--labels .ypin__label,
.ypin--sel .ypin__label {
	display: block;
}
.ycluster {
	display: grid;
	place-items: center;
	align-content: center;
	width: 56px;
	height: 56px;
	border-radius: 50%;
	background: #7a4fc9;
	color: #fff;
	border: 3px solid #fff;
	box-shadow: 0 0 0 6px rgba(122, 79, 201, 0.3), 0 4px 14px rgba(0, 0, 0, 0.45);
	font-family: Inter, system-ui, sans-serif;
	line-height: 1;
	cursor: pointer;
}
.ycluster b {
	font-size: 16px;
}
.ycluster small {
	font-size: 9px;
	opacity: 0.85;
	margin-top: 2px;
}
</style>
