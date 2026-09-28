<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

const props = defineProps({
	markers: { type: Array, default: () => [] },
	center: { type: Array, default: () => [52.36, 115.51] },
	zoom: { type: Number, default: 12 },
	height: { type: String, default: "420px" },
	clickToPick: { type: Boolean, default: false },
	fit: { type: Boolean, default: true },
	selectedId: { type: [String, Number], default: null },
	// Близкие метки объединяются в группу с суммой badge — иначе корпуса одного
	// посёлка лежат друг на друге и нижний не нажать
	cluster: Boolean,
})
const emit = defineEmits(["select", "pick", "located"])
defineExpose({ locate, flyTo: (lat, lng, z = 16) => map?.flyTo([lat, lng], z) })

const el = ref(null)
const wrap = ref(null)
let map = null

// Подложки. Спутник Esri в тайге и посёлках детальнее схемы: улиц в OSM там часто нет,
// а дома на снимке видно. Выбор запоминается.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services"
const LAYERS = {
	scheme: { label: "Схема", tiles: [["https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { subdomains: "abc", maxZoom: 19, attribution: "© OpenStreetMap" }]] },
	satellite: { label: "Спутник", tiles: [[`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, attribution: "© Esri, Maxar" }]] },
	hybrid: {
		label: "Гибрид",
		tiles: [
			[`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, attribution: "© Esri, Maxar" }],
			[`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19 }],
			[`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19 }],
		],
	},
	topo: { label: "Рельеф", tiles: [["https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { subdomains: "abc", maxZoom: 17, attribution: "© OpenTopoMap, © OpenStreetMap" }]] },
}
let stored = "scheme"
try {
	stored = localStorage.getItem("map_layer") || "scheme"
} catch {}
const layerName = ref(LAYERS[stored] ? stored : "scheme")
let tileGroup = null
function setLayer(name) {
	layerName.value = name
	try {
		localStorage.setItem("map_layer", name)
	} catch {}
	if (!map) return
	tileGroup?.remove()
	tileGroup = L.layerGroup(LAYERS[name].tiles.map(([url, opts]) => L.tileLayer(url, opts))).addTo(map)
	tileGroup.eachLayer((l) => l.bringToBack())
	if (map.getZoom() > (LAYERS[name].tiles[0][1].maxZoom || 19)) map.setZoom(LAYERS[name].tiles[0][1].maxZoom)
}

// «Где я»: синяя точка и круг точности
let meLayer = null
const locating = ref(false)
function locate() {
	if (!map) return
	locating.value = true
	map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true })
}
function onLocated(e) {
	locating.value = false
	meLayer?.remove()
	meLayer = L.layerGroup([
		L.circle(e.latlng, { radius: e.accuracy, color: "#4f9cff", weight: 1, fillOpacity: 0.12 }),
		L.circleMarker(e.latlng, { radius: 7, color: "#fff", weight: 2, fillColor: "#4f9cff", fillOpacity: 1 }),
	]).addTo(map)
	emit("located", { lat: e.latlng.lat, lng: e.latlng.lng, accuracy: e.accuracy })
}

// Во весь экран — удобно разглядывать посёлок
const full = ref(false)
// На телефоне один палец листает страницу, карту двигают двумя (во весь экран — одним)
const TOUCH = matchMedia("(pointer: coarse)").matches
function toggleFull() {
	if (document.fullscreenElement) document.exitFullscreen()
	else wrap.value?.requestFullscreen?.()
}
function onFsChange() {
	full.value = document.fullscreenElement === wrap.value
	if (TOUCH) map?.dragging[full.value ? "enable" : "disable"]()
	setTimeout(() => map?.invalidateSize(), 100)
}
let layer = null
let resizeObs = null
const markerById = new Map()

let fitPending = true
const escapeHtml = (s) =>
	String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

// badge — короткая подпись прямо на метке (например, число свободных мест),
// чтобы карта читалась без наведения. shape "home" выделяет «свой» дом.
function makeIcon(marker, selected = false) {
	const color = marker.color || "#c78aff"
	const badge = marker.badge != null && marker.badge !== "" ? String(marker.badge) : null
	const cls = [
		"noch-pin",
		selected ? "noch-pin--selected" : "",
		badge ? "noch-pin--badge" : "",
		marker.shape === "home" ? "noch-pin--home" : "",
	]
		.filter(Boolean)
		.join(" ")
	const size = badge ? (selected ? 42 : 36) : selected ? 30 : 24
	// Подпись рядом с меткой (видна при приближении) — название без открытия попапа
	const label = marker.label ? `<em class="noch-pin__label">${escapeHtml(marker.label)}</em>` : ""
	return L.divIcon({
		className: cls,
		html: badge
			? `<span style="--pin:${color}"><i>${escapeHtml(badge)}</i></span>${label}`
			: `<span style="--pin:${color}"></span>${label}`,
		iconSize: [size, size],
		iconAnchor: [size / 2, size],
		popupAnchor: [0, -size + 4],
	})
}

function markerTitle(marker) {
	return marker.title || marker.name || ""
}

// Жадная группировка по расстоянию в пикселях при текущем масштабе
function groups(list) {
	if (!props.cluster || !map) return list.map((m) => [m])
	const out = []
	for (const m of list) {
		const p = map.latLngToLayerPoint([m._lat, m._lng])
		const g = out.find((x) => x.p.distanceTo(p) < 46)
		if (g) g.items.push(m)
		else out.push({ p, items: [m] })
	}
	return out.map((g) => g.items)
}
const plural = (n) => (n % 10 === 1 && n % 100 !== 11 ? "дом" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "дома" : "домов")

function render() {
	if (!map) return
	if (layer) layer.remove()
	layer = L.layerGroup().addTo(map)
	markerById.clear()
	const pts = []
	const valid = props.markers
		.map((m) => ({ ...m, _lat: Number(m.lat), _lng: Number(m.lng) }))
		.filter((m) => Number.isFinite(m._lat) && Number.isFinite(m._lng))
	for (const m of valid) pts.push([m._lat, m._lng])
	if (fitPending && props.fit) {
		fitPending = false
		if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 14))
		else if (pts.length > 1) map.fitBounds(pts, { padding: [42, 42], maxZoom: 14 })
	}
	for (const items of groups(valid)) {
		if (items.length > 1) {
			const sum = items.reduce((s, m) => s + (Number(m.badge) || 0), 0)
			const hasSel = items.some((m) => String(m.id) === String(props.selectedId))
			const lat = items.reduce((s, m) => s + m._lat, 0) / items.length
			const lng = items.reduce((s, m) => s + m._lng, 0) / items.length
			const icon = L.divIcon({
				className: "noch-cluster" + (hasSel ? " noch-cluster--sel" : ""),
				html: `<span><b>${sum}</b><small>${items.length} ${plural(items.length)}</small></span>`,
				iconSize: [56, 56],
				iconAnchor: [28, 28],
			})
			const cm = L.marker([lat, lng], { icon, title: items.map((m) => m.title || m.label || "").join("\n"), zIndexOffset: 800 }).addTo(layer)
			cm.on("click", () => {
				const b = L.latLngBounds(items.map((m) => [m._lat, m._lng]))
				// Все в одной точке — приближать бесполезно, выбираем первый
				if (b.getNorthEast().equals(b.getSouthWest()) || map.getZoom() >= map.getMaxZoom()) emit("select", items[0].id)
				else map.fitBounds(b, { padding: [80, 80], maxZoom: 18 })
			})
			for (const m of items) markerById.set(String(m.id), cm)
			continue
		}
		const marker = items[0]
		const lat = marker._lat
		const lng = marker._lng
		const selected = String(marker.id) === String(props.selectedId)
		const leafletMarker = L.marker([lat, lng], {
			icon: makeIcon(marker, selected),
			title: markerTitle(marker),
			zIndexOffset: selected ? 1000 : marker.shape === "home" ? 500 : 0,
		}).addTo(layer)
		if (marker.html) leafletMarker.bindPopup(marker.html, { maxWidth: 280 })
		else if (markerTitle(marker)) leafletMarker.bindTooltip(markerTitle(marker), { direction: "top" })
		leafletMarker.on("click", () => {
			emit("select", marker.id)
			if (marker.html) leafletMarker.openPopup()
		})
		markerById.set(String(marker.id), leafletMarker)
	}
	el.value?.classList.toggle("noch-map--labels", map.getZoom() >= 13)
	nextTick(() => map?.invalidateSize())
}

function focusSelected() {
	if (!map || props.selectedId == null) return
	const m = props.markers.find((x) => String(x.id) === String(props.selectedId))
	if (!m || !Number.isFinite(Number(m.lat))) return
	// Приближаем к самому дому, а не к центру группы — группа при этом распадётся
	map.setView([Number(m.lat), Number(m.lng)], Math.max(map.getZoom(), props.cluster ? 16 : 14), { animate: true })
	map.once("moveend", () => markerById.get(String(props.selectedId))?.getPopup() && markerById.get(String(props.selectedId)).openPopup())
}

onMounted(async () => {
	await nextTick()
	map = L.map(el.value, { scrollWheelZoom: true, dragging: !TOUCH }).setView(props.center, props.zoom)
	map.attributionControl.setPrefix(false)
	setLayer(layerName.value)
	L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map)
	map.on("locationfound", onLocated)
	map.on("locationerror", (e) => {
		locating.value = false
		alertLocate(e.message)
	})
	document.addEventListener("fullscreenchange", onFsChange)
	if (props.clickToPick) map.on("click", (e) => emit("pick", { lat: e.latlng.lat, lng: e.latlng.lng }))
	render()
	// Группы и подписи зависят от масштаба
	map.on("zoomend", render)
	// Стабильная отрисовка: пересчитываем размер, когда контейнер реально получил габариты
	setTimeout(() => map?.invalidateSize(), 150)
	setTimeout(() => map?.invalidateSize(), 600)
	if (typeof ResizeObserver !== "undefined") {
		resizeObs = new ResizeObserver(() => map?.invalidateSize())
		resizeObs.observe(el.value)
	}
})

watch(
	() => props.markers,
	(now, before) => {
		// Подгоняем вид только когда сменился сам набор меток (фильтр), а не их числа
		if (!before || now.map((m) => m.id).join() !== before.map((m) => m.id).join()) fitPending = true
		render()
	},
	{ deep: true },
)
watch(() => props.selectedId, () => {
	render()
	nextTick(focusSelected)
})
watch(() => [props.center, props.zoom], () => {
	if (!map || props.fit) return
	const lat = Number(props.center?.[0])
	const lng = Number(props.center?.[1])
	if (Number.isFinite(lat) && Number.isFinite(lng)) map.setView([lat, lng], props.zoom)
}, { deep: true })

function alertLocate(msg) {
	// Без HTTPS браузер не даёт геолокацию — объясняем по-человечески
	const why = location.protocol !== "https:" && location.hostname !== "localhost" ? " Геолокация работает только по HTTPS." : ""
	emit("located", { error: "Не удалось определить местоположение." + why, raw: msg })
}
onBeforeUnmount(() => {
	document.removeEventListener("fullscreenchange", onFsChange)
	if (resizeObs) {
		resizeObs.disconnect()
		resizeObs = null
	}
	if (map) {
		map.remove()
		map = null
	}
})
</script>

<template>
	<div ref="wrap" class="noch-map-wrap" :class="{ full }">
		<div ref="el" class="noch-map" :class="'noch-map--' + layerName" :style="{ height: full ? '100vh' : height }" />
		<div class="noch-map__layers" role="group" aria-label="Подложка карты">
			<button v-for="(l, k) in LAYERS" :key="k" type="button" :class="{ on: layerName === k }" @click="setLayer(k)">{{ l.label }}</button>
		</div>
		<div class="noch-map__tools">
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
.noch-map {
	width: 100%;
	border-radius: var(--radius-lg);
	overflow: hidden;
	border: 1px solid var(--color-divider);
	z-index: 0;
	background: var(--color-raised-bg);
}
.noch-map-wrap {
	position: relative;
	/* кнопки карты не вылезают поверх закреплённых шапок страницы */
	isolation: isolate;
}
.noch-map-wrap.full {
	background: #000;
}
.noch-map__layers,
.noch-map__tools {
	position: absolute;
	z-index: 500;
	display: flex;
	gap: 2px;
	padding: 3px;
	border-radius: 10px;
	background: color-mix(in srgb, var(--color-raised-bg) 92%, transparent);
	border: 1px solid var(--color-divider);
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
}
.noch-map__layers {
	top: 10px;
	right: 10px;
}
.noch-map__tools {
	top: 90px;
	left: 10px;
	flex-direction: column;
}
.noch-map__layers button,
.noch-map__tools button {
	border: none;
	background: transparent;
	color: var(--color-secondary);
	font: inherit;
	font-size: 12px;
	font-weight: 700;
	padding: 5px 9px;
	border-radius: 7px;
	cursor: pointer;
	display: grid;
	place-items: center;
}
.noch-map__tools button {
	width: 30px;
	height: 30px;
	padding: 0;
}
.noch-map__layers button:hover,
.noch-map__tools button:hover {
	color: var(--color-contrast);
}
.noch-map__layers button.on {
	background: var(--color-brand-highlight);
	color: var(--color-brand);
}
.noch-map__tools .spin svg {
	animation: noch-spin 0.9s linear infinite;
}
@keyframes noch-spin {
	to {
		transform: rotate(360deg);
	}
}
/* Тёмная тема — тёмная схема: инвертируем только схему и рельеф, спутник оставляем как есть */
:root[data-theme="dark"] .noch-map--scheme .leaflet-tile-pane,
:root[data-theme="dark"] .noch-map--topo .leaflet-tile-pane {
	filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.85) saturate(0.6);
}
:root[data-theme="dark"] .noch-map .leaflet-control-attribution {
	background: rgba(22, 24, 28, 0.7);
	color: var(--color-secondary);
}
:root[data-theme="dark"] .noch-map .leaflet-control-attribution a {
	color: var(--color-brand);
}
:root[data-theme="dark"] .noch-map .leaflet-bar a {
	background: var(--color-raised-bg);
	color: var(--color-contrast);
	border-color: var(--color-divider);
}
/* Название рядом с меткой — только при приближении, иначе метки слипаются */
.noch-pin__label {
	display: none;
	position: absolute;
	left: calc(100% + 6px);
	top: 50%;
	transform: translateY(-50%);
	padding: 2px 8px;
	border-radius: 999px;
	background: var(--color-super-raised-bg);
	color: var(--color-contrast);
	border: 1px solid var(--color-divider);
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	font-style: normal;
	font-size: 12px;
	font-weight: 700;
	white-space: nowrap;
	pointer-events: none;
}
.noch-map--labels .noch-pin__label,
.noch-pin--selected .noch-pin__label {
	display: block;
}
.noch-cluster span {
	display: grid;
	place-items: center;
	align-content: center;
	width: 56px;
	height: 56px;
	border-radius: 50%;
	background: color-mix(in srgb, var(--color-brand) 85%, #000);
	color: #fff;
	border: 3px solid #fff;
	box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-brand), transparent 70%), 0 4px 14px rgba(0, 0, 0, 0.45);
	cursor: pointer;
	line-height: 1;
}
.noch-cluster b {
	font-size: 16px;
	font-weight: 800;
}
.noch-cluster small {
	font-size: 9px;
	opacity: 0.85;
	margin-top: 2px;
}
.noch-cluster--sel span {
	box-shadow: 0 0 0 6px color-mix(in srgb, #fff, transparent 60%), 0 4px 14px rgba(0, 0, 0, 0.45);
}
.noch-pin span {
	display: block;
	width: 20px;
	height: 20px;
	background: var(--pin);
	border: 2px solid #fff;
	border-radius: 50% 50% 50% 0;
	transform: rotate(-45deg);
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}
.noch-pin--selected span {
	width: 26px;
	height: 26px;
	border-width: 3px;
	box-shadow: 0 0 0 6px color-mix(in srgb, var(--pin), transparent 72%), 0 4px 12px rgba(0, 0, 0, 0.45);
}

/* Метка с числом: читается без наведения */
.noch-pin--badge span {
	width: 34px;
	height: 34px;
	border-radius: var(--radius-max);
	transform: none;
	display: grid;
	place-items: center;
	border: 2px solid #fff;
}
.noch-pin--badge i {
	font-style: normal;
	font-weight: 800;
	font-size: 13px;
	line-height: 1;
	color: #10131a;
	letter-spacing: -0.02em;
}
.noch-pin--badge.noch-pin--selected span {
	width: 40px;
	height: 40px;
	box-shadow: 0 0 0 6px color-mix(in srgb, var(--pin), transparent 70%), 0 6px 16px rgba(0, 0, 0, 0.5);
}
.noch-pin--badge.noch-pin--selected i {
	font-size: 15px;
}
/* «Мой дом» — квадратная метка, чтобы не путать с точками интереса */
.noch-pin--home span {
	border-radius: var(--radius-md);
	transform: none;
	width: 26px;
	height: 26px;
	box-shadow: 0 0 0 5px color-mix(in srgb, var(--pin), transparent 74%), 0 3px 10px rgba(0, 0, 0, 0.45);
}
.leaflet-popup-content {
	font-family: inherit;
	font-size: var(--font-size-sm);
	line-height: 1.5;
	margin: 10px 12px;
}
.leaflet-popup-content-wrapper,
.leaflet-popup-tip {
	background: var(--color-super-raised-bg);
	color: var(--color-base);
}
.leaflet-container {
	font-family: inherit;
}
</style>
