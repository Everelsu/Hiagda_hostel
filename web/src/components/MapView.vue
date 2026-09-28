<script setup>
// Карта для всего приложения. Яндекс — если задан ключ и API загрузился (точнее по России),
// иначе OpenStreetMap/Esri. Пользователь может переключить сам, выбор запоминается.
// Все свойства и события прозрачно передаются выбранной реализации.
import { ref, shallowRef, onMounted } from "vue"
import LeafletMap from "./LeafletMap.vue"
import YandexMap from "./YandexMap.vue"
import { loadYandex, mapProvider, setMapProvider } from "@/utils/yandex"

defineOptions({ inheritAttrs: false })
const impl = shallowRef(null)
const yandexOk = ref(false)
const inner = ref(null)

onMounted(async () => {
	yandexOk.value = !!(await loadYandex())
	impl.value = yandexOk.value && mapProvider() === "yandex" ? YandexMap : LeafletMap
})
// Одним пальцем карта не двигается (листается страница) — подсказываем, как её двигать
const hint = ref(false)
let hintTimer = 0
function onTouch(e) {
	if (e.touches.length !== 1 || document.fullscreenElement || !matchMedia("(pointer: coarse)").matches) return
	if (e.target.closest?.("button")) return
	hint.value = true
	clearTimeout(hintTimer)
	hintTimer = setTimeout(() => (hint.value = false), 1400)
}
function switchTo(p) {
	setMapProvider(p)
	impl.value = p === "yandex" ? YandexMap : LeafletMap
}
defineExpose({
	locate: () => inner.value?.locate(),
	flyTo: (...a) => inner.value?.flyTo(...a),
})
</script>

<template>
	<div class="mapview" @touchmove.passive="onTouch">
		<component :is="impl" v-if="impl" ref="inner" v-bind="$attrs" />
		<div v-else class="mapview__wait" :style="{ height: $attrs.height || '420px' }">Загружаем карту…</div>
		<Transition name="fade"><div v-if="hint" class="mapview__hint">Двигайте карту двумя пальцами</div></Transition>
		<div v-if="yandexOk && impl" class="mapview__prov" role="group" aria-label="Источник карты">
			<button type="button" :class="{ on: impl === YandexMap }" @click="switchTo('yandex')">Яндекс</button>
			<button type="button" :class="{ on: impl === LeafletMap }" @click="switchTo('osm')">OSM / спутник Esri</button>
		</div>
	</div>
</template>

<style scoped>
.mapview {
	position: relative;
	/* свои кнопки и слои карты не вылезают поверх закреплённых шапок */
	isolation: isolate;
}
.mapview__wait {
	display: grid;
	place-items: center;
	border-radius: var(--radius-lg);
	border: 1px solid var(--color-divider);
	background: var(--color-raised-bg);
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
}
.mapview__hint {
	position: absolute;
	inset: 0;
	z-index: 700;
	display: grid;
	place-items: center;
	border-radius: var(--radius-lg);
	background: rgba(0, 0, 0, 0.45);
	color: #fff;
	font-weight: 700;
	font-size: var(--font-size-sm);
	pointer-events: none;
}
.fade-enter-active,
.fade-leave-active {
	transition: opacity 200ms ease;
}
.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}
/* Переключатель источника — внизу слева, не перекрывает контролы обеих карт */
.mapview__prov {
	position: absolute;
	left: 10px;
	bottom: 34px;
	z-index: 600;
	display: flex;
	gap: 2px;
	padding: 3px;
	border-radius: 10px;
	background: color-mix(in srgb, var(--color-raised-bg) 92%, transparent);
	border: 1px solid var(--color-divider);
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
}
.mapview__prov button {
	border: none;
	background: transparent;
	color: var(--color-secondary);
	font: inherit;
	font-size: 11px;
	font-weight: 700;
	padding: 4px 8px;
	border-radius: 7px;
	cursor: pointer;
}
.mapview__prov button.on {
	background: var(--color-brand-highlight);
	color: var(--color-brand);
}
</style>
