<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

const props = defineProps({
	markers: { type: Array, default: () => [] },
	center: { type: Array, default: () => [54.4, 113.0] },
	zoom: { type: Number, default: 5 },
	height: { type: String, default: "420px" },
	clickToPick: { type: Boolean, default: false },
	fit: { type: Boolean, default: true },
})
const emit = defineEmits(["select", "pick"])

const el = ref(null)
let map = null
let layer = null

function makeIcon(color) {
	return L.divIcon({
		className: "noch-pin",
		html: `<span style="--pin:${color || "#c78aff"}"></span>`,
		iconSize: [24, 24],
		iconAnchor: [12, 24],
		popupAnchor: [0, -22],
	})
}

function render() {
	if (!map) return
	if (layer) layer.remove()
	layer = L.layerGroup().addTo(map)
	const pts = []
	for (const m of props.markers) {
		const lat = Number(m.lat)
		const lng = Number(m.lng)
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
		const mk = L.marker([lat, lng], { icon: makeIcon(m.color) }).addTo(layer)
		if (m.html) mk.bindPopup(m.html)
		else if (m.title) mk.bindTooltip(m.title, { direction: "top" })
		mk.on("click", () => emit("select", m.id))
		pts.push([lat, lng])
	}
	if (!props.fit) return
	if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 13))
	else if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 })
}

onMounted(async () => {
	await nextTick()
	map = L.map(el.value, { scrollWheelZoom: true }).setView(props.center, props.zoom)
	map.attributionControl.setPrefix(false)
	L.tileLayer("https://tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1", {
		subdomains: ["0", "1", "2", "3"],
		maxZoom: 18,
		attribution: "© 2ГИС",
	}).addTo(map)
	if (props.clickToPick) map.on("click", (e) => emit("pick", { lat: e.latlng.lat, lng: e.latlng.lng }))
	render()
	setTimeout(() => map && map.invalidateSize(), 200)
})

watch(() => props.markers, render, { deep: true })
onBeforeUnmount(() => {
	if (map) {
		map.remove()
		map = null
	}
})
</script>

<template>
	<div ref="el" class="noch-map" :style="{ height }" />
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
.noch-pin span {
	display: block;
	width: 20px;
	height: 20px;
	background: var(--pin);
	border: 2px solid #fff;
	border-radius: 50% 50% 50% 0;
	transform: rotate(-45deg);
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
}
.leaflet-popup-content {
	font-family: inherit;
	font-size: var(--font-size-sm);
	line-height: 1.5;
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
