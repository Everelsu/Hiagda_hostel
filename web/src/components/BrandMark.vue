<script setup>
/**
 * Знак «Хиагды» — вихрь из шести лепестков вокруг ядра (из фирменного логотипа),
 * перекрашенный в цвета приложения. animated — лепестки собираются при появлении,
 * потом знак медленно вращается (на входе); без анимации — для шапок.
 */
import { useId } from "vue"

defineProps({ size: { type: String, default: "1.5em" }, animated: Boolean })
const id = useId()
// Градиенты лепестков — из исходного логотипа (координаты те же), цвета — фирменные
const PETALS = [
	{
		d: "M62.8,31.3c47.4-23,80.3-7.1,100.7,12.9c2.7,2.7,5.2,5.4,7.5,8.1c13,15.5,19,30.8,19,30.8c8.3,1.5,16,2,23.2,1.6c0.5,0,0.9,0,1.4-0.1c0.4,0,0.8-0.1,1.3-0.1c15.9-1.4,36.7-7.6,55.6-26.5c0.7-0.7,1.3-1.3,1.9-2c-2.9-3.5-6-6.9-9.2-10.2c-30.1-30-69.6-45.1-109-45.1C122.7,0.6,90.2,10.8,62.8,31.3",
		g: [110.9, 298.3, 246.5, 243.7],
	},
	{
		d: "M5.3,113c-20,75.1,18.8,151.8,88.2,181.6c-43.6-29.6-46.3-66-39.1-93.7c0.9-3.7,2.1-7.2,3.3-10.5c7-19,17.2-31.9,17.2-31.9c-2.8-7.9-6.3-14.8-10.2-20.9c-0.3-0.4-0.5-0.8-0.7-1.2c-0.2-0.4-0.5-0.7-0.7-1c-9.2-13.1-24.9-28-50.8-34.9c-0.9-0.2-1.8-0.4-2.7-0.7C7.9,104.2,6.5,108.5,5.3,113",
		g: [51.8, 46.2, 31.3, 190.9],
	},
	{
		d: "M245,217.3c-3.7,1-7.2,1.8-10.7,2.4c-19.9,3.5-36.2,1.1-36.2,1.1c-5.5,6.4-9.7,12.9-13,19.3c-0.2,0.4-0.4,0.8-0.6,1.2c-0.2,0.4-0.3,0.8-0.5,1.1c-6.7,14.5-11.8,35.5-4.8,61.4c0.2,0.9,0.5,1.8,0.8,2.7c4.5-0.8,9-1.7,13.5-2.9c75-20.2,122.1-92.2,113.2-167.1C302.7,189.2,272.6,209.7,245,217.3",
		g: [300.1, 120.9, 185, 30.8],
	},
	{
		d: "M62.8,31.3c0,0-33.5,21-51,63c4.6,0.8,51.3,10.2,68.7,62.1c4.3-2.7,17.3-13,26.1-41.5c10.6-34.4,30.8-59.7,56.9-70.8c0,0-17.8-25.4-54-25.4C96.4,18.8,80.8,22.1,62.8,31.3",
		g: [56.7, 194.5, 117.6, 288.1],
	},
	{
		d: "M93.4,294.6c0,0,34.8,18.5,80,12.6c-0.8-2.2-4.5-13.2-4.5-28.5c0-17.4,4.8-40.5,24.2-62.2l0.2-0.3c-3.2-3.4-14.2-11.7-42.7-5.2c-35.1,8-73.8,7.1-96.4-10C54.3,200.9,30,253.1,93.4,294.6",
		g: [172, 61.1, 62.6, 50],
	},
	{
		d: "M209.2,91.9c-6.4,0-13.1-0.6-20.3-2.1l-0.3-0.1c-1.3,4.8-2.4,18.3,16.9,39.2c24.4,26.4,43,60.3,39.5,88.5c0,0,57.4-5.1,61.5-80.7c0,0-1.4-39.5-29.1-75.6C272.4,67,248.7,91.8,209.2,91.9",
		g: [242.4, 219.3, 264.7, 106.8],
	},
]
const CORE = "M131.3,133c-11.9,13.2-10.9,33.7,2.3,45.6c13.2,12,33.5,11,45.5-2.3c11.9-13.2,10.9-33.7-2.3-45.6c-6.2-5.6-13.9-8.4-21.6-8.4C146.3,122.4,137.6,126,131.3,133"
</script>

<template>
	<svg class="bmark" :class="{ 'bmark--anim': animated }" viewBox="0 0 311 309" :style="{ width: size, height: size }" aria-hidden="true">
		<defs>
			<linearGradient
				v-for="(p, i) in PETALS"
				:id="`${id}-p${i}`"
				:key="i"
				gradientUnits="userSpaceOnUse"
				:x1="p.g[0]"
				:y1="p.g[1]"
				:x2="p.g[2]"
				:y2="p.g[3]"
				gradientTransform="matrix(1 0 0 -1 0 309.2756)"
			>
				<stop offset="0" style="stop-color: var(--mark-hi, #dcc6ff)" />
				<stop offset="1" style="stop-color: var(--mark-lo, #5b2fb8)" />
			</linearGradient>
			<radialGradient :id="`${id}-core`" cx="0.45" cy="0.4" r="0.7">
				<stop offset="0" style="stop-color: var(--mark-core-hi, #f3eaff)" />
				<stop offset="1" style="stop-color: var(--mark-lo, #5b2fb8)" />
			</radialGradient>
		</defs>
		<g class="bmark__spin">
			<path v-for="(p, i) in PETALS" :key="i" class="bmark__petal" :style="{ '--i': i }" :d="p.d" :fill="`url(#${id}-p${i})`" />
			<path class="bmark__core" :d="CORE" :fill="`url(#${id}-core)`" />
		</g>
	</svg>
</template>

<style scoped>
.bmark {
	display: inline-block;
	flex-shrink: 0;
	overflow: visible;
}
.bmark__spin,
.bmark__petal,
.bmark__core {
	transform-box: view-box;
	transform-origin: 155px 155px;
}
/* Лепестки слетаются к ядру по очереди, потом знак неспешно вращается, ядро «дышит» */
.bmark--anim .bmark__petal {
	animation: petal-in 900ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
	animation-delay: calc(var(--i) * 90ms);
}
.bmark--anim .bmark__core {
	animation:
		core-in 700ms 500ms cubic-bezier(0.3, 1.5, 0.5, 1) both,
		core-breathe 4s 1.4s ease-in-out infinite;
}
.bmark--anim .bmark__spin {
	animation: spin 80s linear infinite;
}
@keyframes petal-in {
	from {
		opacity: 0;
		transform: rotate(-80deg) scale(0.55);
	}
}
@keyframes core-in {
	from {
		opacity: 0;
		transform: scale(0.2);
	}
}
@keyframes core-breathe {
	50% {
		transform: scale(1.08);
	}
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
@media (prefers-reduced-motion: reduce) {
	.bmark--anim .bmark__petal,
	.bmark--anim .bmark__core,
	.bmark--anim .bmark__spin {
		animation: none;
	}
}
</style>
