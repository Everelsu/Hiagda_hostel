<script setup>
/**
 * План этажа на SVG-сетке. Один компонент на два сценария:
 *  - просмотр (персонал видит загрузку, вахтовик — «вы здесь»);
 *  - редактирование (перетаскивание и изменение размера номеров и элементов).
 * Координаты хранятся в клетках сетки, пиксели считаются только при отрисовке.
 */
import { ref, computed } from "vue"
import Icon from "@/components/Icon.vue"

const props = defineProps({
	rooms: { type: Array, default: () => [] }, // { id, number, plan_x, plan_y, plan_w, plan_h, tone, label, sub, highlight }
	shapes: { type: Array, default: () => [] }, // { id, kind, label, x, y, w, h }
	cols: { type: Number, default: 24 },
	rows: { type: Number, default: 16 },
	cell: { type: Number, default: 34 },
	editable: { type: Boolean, default: false },
	selectedId: { type: [String, Number], default: null },
})
const emit = defineEmits(["select", "move", "open"])

const SHAPE_META = {
	corridor: { label: "Коридор", icon: "arrow-right", fill: "var(--plan-corridor)" },
	stairs: { label: "Лестница", icon: "layout", fill: "var(--plan-service)" },
	exit: { label: "Выход", icon: "log-out", fill: "var(--plan-exit)" },
	wc: { label: "Санузел", icon: "droplet", fill: "var(--plan-service)" },
	shower: { label: "Душевая", icon: "droplet", fill: "var(--plan-service)" },
	kitchen: { label: "Кухня", icon: "utensils", fill: "var(--plan-service)" },
	laundry: { label: "Прачечная", icon: "washing-machine", fill: "var(--plan-service)" },
	lounge: { label: "Комната отдыха", icon: "armchair", fill: "var(--plan-service)" },
	office: { label: "Комендант", icon: "user-cog", fill: "var(--plan-service)" },
	other: { label: "Помещение", icon: "dot", fill: "var(--plan-service)" },
}
const shapeMeta = (kind) => SHAPE_META[kind] || SHAPE_META.other

const svg = ref(null)
const drag = ref(null)

const width = computed(() => props.cols * props.cell)
const height = computed(() => props.rows * props.cell)
const placedRooms = computed(() => props.rooms.filter((r) => r.plan_x != null))

// Пиксели → клетки с учётом реального масштаба SVG (он резиновый по ширине)
function toCells(event) {
	const box = svg.value.getBoundingClientRect()
	const scale = box.width / width.value || 1
	return {
		cx: (event.clientX - box.left) / scale / props.cell,
		cy: (event.clientY - box.top) / scale / props.cell,
	}
}

function startDrag(event, item, type, mode) {
	if (!props.editable) return
	event.preventDefault()
	event.stopPropagation()
	const { cx, cy } = toCells(event)
	const x = type === "room" ? item.plan_x : item.x
	const y = type === "room" ? item.plan_y : item.y
	const w = type === "room" ? item.plan_w : item.w
	const h = type === "room" ? item.plan_h : item.h
	drag.value = { item, type, mode, offX: cx - x, offY: cy - y, startW: w, startH: h, startCx: cx, startCy: cy, moved: false }
	emit("select", type === "room" ? item.id : "shape-" + item.id)
	window.addEventListener("pointermove", onDrag)
	window.addEventListener("pointerup", endDrag, { once: true })
}

function onDrag(event) {
	const d = drag.value
	if (!d) return
	const { cx, cy } = toCells(event)
	d.moved = true
	if (d.mode === "move") {
		const nx = Math.max(0, Math.min(props.cols - (d.type === "room" ? d.item.plan_w : d.item.w), Math.round(cx - d.offX)))
		const ny = Math.max(0, Math.min(props.rows - (d.type === "room" ? d.item.plan_h : d.item.h), Math.round(cy - d.offY)))
		emit("move", { type: d.type, id: d.item.id, x: nx, y: ny })
	} else {
		const nw = Math.max(1, Math.min(props.cols - (d.type === "room" ? d.item.plan_x : d.item.x), Math.round(d.startW + (cx - d.startCx))))
		const nh = Math.max(1, Math.min(props.rows - (d.type === "room" ? d.item.plan_y : d.item.y), Math.round(d.startH + (cy - d.startCy))))
		emit("move", { type: d.type, id: d.item.id, w: nw, h: nh })
	}
}

function endDrag() {
	window.removeEventListener("pointermove", onDrag)
	drag.value = null
}

function onClick(item, type) {
	if (drag.value?.moved) return
	if (type === "room") emit("open", item)
}

const px = (n) => n * props.cell
</script>

<template>
	<div class="plan-wrap">
		<svg ref="svg" class="plan" :viewBox="`0 0 ${width} ${height}`" :style="{ aspectRatio: `${width} / ${height}` }">
			<defs>
				<pattern id="plan-grid" :width="cell" :height="cell" patternUnits="userSpaceOnUse">
					<path :d="`M ${cell} 0 L 0 0 0 ${cell}`" fill="none" stroke="var(--plan-grid)" stroke-width="1" />
				</pattern>
			</defs>
			<rect :width="width" :height="height" fill="var(--plan-bg)" />
			<rect v-if="editable" :width="width" :height="height" fill="url(#plan-grid)" />

			<!-- Служебные помещения рисуем под номерами -->
			<g v-for="s in shapes" :key="'s' + s.id" class="shape" :class="{ on: selectedId === 'shape-' + s.id, editable }">
				<rect
					:x="px(s.x)"
					:y="px(s.y)"
					:width="px(s.w)"
					:height="px(s.h)"
					rx="6"
					:fill="shapeMeta(s.kind).fill"
					stroke="var(--plan-shape-stroke)"
					stroke-dasharray="4 3"
					@pointerdown="startDrag($event, s, 'shape', 'move')"
				/>
				<foreignObject :x="px(s.x)" :y="px(s.y)" :width="px(s.w)" :height="px(s.h)" class="no-events">
					<div class="shape-label">
						<Icon :name="shapeMeta(s.kind).icon" size="0.95rem" />
						<span v-if="px(s.w) > 70">{{ s.label || shapeMeta(s.kind).label }}</span>
					</div>
				</foreignObject>
				<rect
					v-if="editable"
					class="handle"
					:x="px(s.x + s.w) - 11"
					:y="px(s.y + s.h) - 11"
					width="11"
					height="11"
					rx="2"
					@pointerdown="startDrag($event, s, 'shape', 'resize')"
				/>
			</g>

			<!-- Номера -->
			<g
				v-for="r in placedRooms"
				:key="'r' + r.id"
				class="room"
				:class="[r.tone, { on: selectedId === r.id, editable, highlight: r.highlight }]"
			>
				<rect
					:x="px(r.plan_x)"
					:y="px(r.plan_y)"
					:width="px(r.plan_w)"
					:height="px(r.plan_h)"
					rx="6"
					@pointerdown="startDrag($event, r, 'room', 'move')"
					@click="onClick(r, 'room')"
				/>
				<foreignObject
					:x="px(r.plan_x)"
					:y="px(r.plan_y)"
					:width="px(r.plan_w)"
					:height="px(r.plan_h)"
					class="no-events"
				>
					<div class="room-label">
						<b>{{ r.label || "№ " + r.number }}</b>
						<span v-if="r.sub && px(r.plan_h) > 52">{{ r.sub }}</span>
						<span v-if="r.highlight" class="here">вы здесь</span>
					</div>
				</foreignObject>
				<rect
					v-if="editable"
					class="handle"
					:x="px(r.plan_x + r.plan_w) - 11"
					:y="px(r.plan_y + r.plan_h) - 11"
					width="11"
					height="11"
					rx="2"
					@pointerdown="startDrag($event, r, 'room', 'resize')"
				/>
			</g>
		</svg>
	</div>
</template>

<style scoped>
.plan-wrap {
	--plan-bg: var(--color-bg);
	--plan-grid: color-mix(in srgb, var(--color-divider), transparent 45%);
	--plan-corridor: color-mix(in srgb, var(--color-secondary), transparent 88%);
	--plan-service: color-mix(in srgb, var(--color-blue), transparent 86%);
	--plan-exit: color-mix(in srgb, var(--color-green), transparent 82%);
	--plan-shape-stroke: color-mix(in srgb, var(--color-secondary), transparent 55%);
	width: 100%;
	overflow: auto;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	background: var(--color-bg);
}
.plan {
	display: block;
	width: 100%;
	min-width: 560px;
	touch-action: none;
}
.no-events {
	pointer-events: none;
}

/* Номера: цвет = загрузка */
.room rect {
	fill: var(--color-raised-bg);
	stroke: var(--color-divider);
	stroke-width: 1.5;
	cursor: pointer;
}
.room.free rect {
	fill: color-mix(in srgb, var(--color-gray), transparent 78%);
	stroke: var(--color-gray);
}
.room.part rect {
	fill: color-mix(in srgb, var(--color-green), transparent 78%);
	stroke: var(--color-green);
}
.room.full rect {
	fill: color-mix(in srgb, var(--color-red), transparent 78%);
	stroke: var(--color-red);
}
.room.repair rect {
	fill: color-mix(in srgb, var(--color-orange), transparent 74%);
	stroke: var(--color-orange);
}
.room.plain rect {
	fill: color-mix(in srgb, var(--color-secondary), transparent 84%);
	stroke: var(--color-divider);
}
.room:hover rect {
	stroke-width: 2.5;
}
.room.on rect {
	stroke: var(--color-brand);
	stroke-width: 3;
}
.room.highlight rect {
	fill: color-mix(in srgb, var(--color-brand), transparent 62%);
	stroke: var(--color-brand);
	stroke-width: 3;
}
.room.editable rect {
	cursor: grab;
}
.room-label {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100%;
	gap: 1px;
	padding: 2px;
	text-align: center;
	line-height: 1.15;
	overflow: hidden;
}
.room-label b {
	color: var(--color-contrast);
	font-size: 12px;
	font-weight: 800;
	white-space: nowrap;
}
.room-label span {
	color: var(--color-secondary);
	font-size: 10px;
	white-space: nowrap;
}
.room-label .here {
	color: var(--color-brand);
	font-weight: 800;
	text-transform: uppercase;
	letter-spacing: 0.03em;
	font-size: 9px;
}
.shape rect {
	cursor: default;
}
.shape.editable rect {
	cursor: grab;
}
.shape.on rect:first-child {
	stroke: var(--color-brand);
	stroke-dasharray: none;
	stroke-width: 2;
}
.shape-label {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	height: 100%;
	color: var(--color-secondary);
	font-size: 11px;
	font-weight: 600;
	overflow: hidden;
	white-space: nowrap;
}
.handle {
	fill: var(--color-brand);
	stroke: #fff;
	stroke-width: 1.5;
	cursor: nwse-resize;
}
</style>
