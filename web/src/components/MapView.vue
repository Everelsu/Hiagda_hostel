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
})
const emit = defineEmits(["select", "pick"])

const el = ref(null)
let map = null
let layer = null
const markerById = new Map()

function makeIcon(color, selected = false) {
	return L.divIcon({
		className: `noch-pin${selected ? " noch-pin--selected" : ""}`,
		html: `<span style="--pin:${color || "#c78aff"}"></span>`,
		iconSize: selected ? [30, 30] : [24, 24],
		iconAnchor: selected ? [15, 30] : [12, 24],
		popupAnchor: [0, -22],
	})
}

function markerTitle(marker) {
	return marker.title || marker.name || ""
}

function render() {
	if (!map) return
	if (layer) layer.remove()
	layer = L.layerGroup().addTo(map)
	markerById.clear()
	const pts = []
	for (const marker of props.markers) {
		const lat = Number(marker.lat)
		const lng = Number(marker.lng)
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
		const selected = String(marker.id) === String(props.selectedId)
		const leafletMarker = L.marker([lat, lng], { icon: makeIcon(marker.color, selected), title: markerTitle(marker) }).addTo(layer)
		if (marker.html) leafletMarker.bindPopup(marker.html, { maxWidth: 280 })
		else if (markerTitle(marker)) leafletMarker.bindTooltip(markerTitle(marker), { direction: "top" })
		leafletMarker.on("click", () => {
			emit("select", marker.id)
			if (marker.html) leafletMarker.openPopup()
		})
		markerById.set(String(marker.id), leafletMarker)
		pts.push([lat, lng])
	}
	if (props.fit) {
		if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 14))
		else if (pts.length > 1) map.fitBounds(pts, { padding: [42, 42], maxZoom: 14 })
	}
	nextTick(() => map?.invalidateSize())
}

function focusSelected() {
	if (!map || props.selectedId == null) return
	const marker = markerById.get(String(props.selectedId))
	if (!marker) return
	map.setView(marker.getLatLng(), Math.max(map.getZoom(), 14), { animate: true })
	if (marker.getPopup()) marker.openPopup()
}

onMounted(async () => {
	await nextTick()
	map = L.map(el.value, { scrollWheelZoom: true }).setView(props.center, props.zoom)
	map.attributionControl.setPrefix(false)
	L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
		maxZoom: 19,
		attribution: "© OpenStreetMap",
	}).addTo(map)
	if (props.clickToPick) map.on("click", (e) => emit("pick", { lat: e.latlng.lat, lng: e.latlng.lng }))
	render()
	setTimeout(() => map?.invalidateSize(), 150)
})

watch(() => props.markers, render, { deep: true })
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
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}
.noch-pin--selected span {
	width: 26px;
	height: 26px;
	border-width: 3px;
	box-shadow: 0 0 0 6px color-mix(in srgb, var(--pin), transparent 72%), 0 4px 12px rgba(0, 0, 0, 0.45);
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
