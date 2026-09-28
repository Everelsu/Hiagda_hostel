<script setup>
// Поиск точки по адресу. Сначала геокодер Яндекса (точнее по России, нужен ключ),
// если он недоступен — OpenStreetMap Nominatim. Выбор ставит точку на карте.
import { ref } from "vue"
import Icon from "@/components/Icon.vue"
import { yandexGeocode } from "@/utils/yandex"

const emit = defineEmits(["pick"])
const props = defineProps({ placeholder: { type: String, default: "Адрес или посёлок: «Багдарин, Ленина 12»" } })
const q = ref("")
const results = ref([])
const busy = ref(false)
const error = ref("")

async function search() {
	const text = q.value.trim()
	if (text.length < 3) return
	busy.value = true
	error.value = ""
	try {
		try {
			results.value = await yandexGeocode(text)
		} catch {
			const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=ru&accept-language=ru&q=${encodeURIComponent(text)}`
			results.value = (await (await fetch(url)).json()).map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: r.display_name }))
		}
		if (!results.value.length) error.value = "Не нашли. Уточните посёлок или поставьте точку кликом по карте."
	} catch {
		error.value = "Поиск недоступен (нет интернета?). Поставьте точку кликом по карте."
	} finally {
		busy.value = false
	}
}
function pick(r) {
	emit("pick", { lat: r.lat, lng: r.lng, label: r.label })
	results.value = []
	q.value = r.label.split(",").slice(0, 3).join(",")
}

// Обратный геокодинг: по точке — адрес (для поля «Адрес»)
async function reverse(lat, lng) {
	try {
		const [y] = await yandexGeocode([Number(lat), Number(lng)], 1)
		if (y) return y
	} catch {}
	const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ru&lat=${lat}&lon=${lng}`
	const r = await (await fetch(url)).json()
	const a = r.address || {}
	return {
		settlement: a.village || a.town || a.city || a.hamlet || a.settlement || "",
		address: [a.road, a.house_number].filter(Boolean).join(", "),
		label: r.display_name || "",
	}
}
defineExpose({ reverse })
</script>

<template>
	<div class="geo">
		<div class="geo__row">
			<Icon name="search" class="geo__ic" />
			<input v-model="q" class="geo__input" :placeholder="props.placeholder" @keydown.enter.prevent="search" />
			<button type="button" class="geo__btn" :disabled="busy || q.trim().length < 3" @click="search">{{ busy ? "Ищем…" : "Найти" }}</button>
		</div>
		<ul v-if="results.length" class="geo__list">
			<li v-for="r in results" :key="r.lat + ',' + r.lng">
				<button type="button" @click="pick(r)">
					<Icon name="map-pin" />
					<span>{{ r.label }}</span>
				</button>
			</li>
		</ul>
		<p v-if="error" class="geo__err">{{ error }}</p>
	</div>
</template>

<style scoped>
.geo {
	display: grid;
	gap: 6px;
}
.geo__row {
	position: relative;
	display: flex;
	gap: 6px;
}
.geo__ic {
	position: absolute;
	left: 0.75rem;
	top: 50%;
	transform: translateY(-50%);
	color: var(--color-secondary);
	pointer-events: none;
}
.geo__input {
	flex: 1;
	min-width: 0;
	height: var(--control-h-md);
	padding: 0 var(--gap-md) 0 2.2rem;
	border-radius: var(--radius-md);
	border: 1px solid var(--color-button-border);
	background: var(--color-bg);
	color: var(--color-contrast);
	font: inherit;
	font-size: var(--font-size-sm);
}
.geo__input:focus {
	outline: none;
	border-color: var(--color-brand);
	box-shadow: 0 0 0 3px var(--color-brand-highlight);
}
.geo__btn {
	height: var(--control-h-md);
	padding: 0 var(--gap-md);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-button-border);
	background: var(--color-button-bg);
	color: var(--color-base);
	font: inherit;
	font-size: var(--font-size-sm);
	font-weight: var(--font-weight-bold);
	cursor: pointer;
}
.geo__btn:disabled {
	opacity: 0.5;
	cursor: default;
}
.geo__list {
	list-style: none;
	margin: 0;
	padding: 4px;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	background: var(--color-super-raised-bg);
	max-height: 220px;
	overflow-y: auto;
}
.geo__list button {
	display: flex;
	gap: var(--gap-sm);
	align-items: flex-start;
	width: 100%;
	padding: 6px var(--gap-sm);
	border: none;
	border-radius: var(--radius-sm);
	background: transparent;
	color: var(--color-base);
	font: inherit;
	font-size: var(--font-size-xs);
	text-align: left;
	cursor: pointer;
}
.geo__list button:hover {
	background: var(--color-brand-highlight);
	color: var(--color-contrast);
}
.geo__list :deep(svg) {
	color: var(--color-brand);
	margin-top: 2px;
	flex-shrink: 0;
}
.geo__err {
	margin: 0;
	font-size: var(--font-size-xs);
	color: var(--color-orange);
}
</style>
