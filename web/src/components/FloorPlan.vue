<script setup>
/**
 * План этажа на SVG-сетке. Один компонент на два сценария:
 *  - просмотр (персонал видит загрузку, вахтовик — «вы здесь»);
 *  - редактирование (перетаскивание, размер, вырезание клеток).
 *
 * Форма помещения: габарит x/y/w/h + необязательная маска занятых клеток
 * ("111/101" — по строке на ряд). Маска даёт углы, впадины и Г-образные комнаты.
 * Контур рисуем по тем рёбрам клеток, у которых нет занятого соседа.
 */
import { ref, computed } from "vue"
import Icon from "@/components/Icon.vue"

const props = defineProps({
	rooms: { type: Array, default: () => [] },
	shapes: { type: Array, default: () => [] },
	cols: { type: Number, default: 24 },
	rows: { type: Number, default: 16 },
	cell: { type: Number, default: 34 },
	editable: { type: Boolean, default: false },
	carving: { type: Boolean, default: false },
	selectedId: { type: [String, Number], default: null },
})
const emit = defineEmits(["select", "move", "open", "carve"])

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
const px = (n) => n * props.cell

/* ---------- геометрия клеток ---------- */
function parseMask(mask, w, h) {
	const grid = []
	const rowsIn = typeof mask === "string" && mask ? mask.split("/") : []
	for (let y = 0; y < h; y++) {
		const src = rowsIn[y] ?? ""
		const row = []
		for (let x = 0; x < w; x++) row.push(rowsIn.length ? src[x] !== "0" : true)
		grid.push(row)
	}
	return grid
}

// Прямоугольники занятых клеток + внешний контур (рёбра без занятого соседа)
function geometry(box) {
	const { x, y, w, h, mask } = box
	const grid = parseMask(mask, w, h)
	const cells = []
	const edges = []
	const on = (cx, cy) => cx >= 0 && cy >= 0 && cx < w && cy < h && grid[cy][cx]
	for (let cy = 0; cy < h; cy++) {
		for (let cx = 0; cx < w; cx++) {
			if (!grid[cy][cx]) continue
			cells.push({ x: px(x + cx), y: px(y + cy), w: props.cell, h: props.cell })
			const ax = px(x + cx)
			const ay = px(y + cy)
			const bx = ax + props.cell
			const by = ay + props.cell
			if (!on(cx, cy - 1)) edges.push({ x1: ax, y1: ay, x2: bx, y2: ay })
			if (!on(cx, cy + 1)) edges.push({ x1: ax, y1: by, x2: bx, y2: by })
			if (!on(cx - 1, cy)) edges.push({ x1: ax, y1: ay, x2: ax, y2: by })
			if (!on(cx + 1, cy)) edges.push({ x1: bx, y1: ay, x2: bx, y2: by })
		}
	}
	// Подпись ставим в центр масс занятых клеток, чтобы не висела над вырезом
	let sx = 0
	let sy = 0
	for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) if (grid[cy][cx]) (sx += cx + 0.5), (sy += cy + 0.5)
	const n = cells.length || 1
	const cxAvg = sx / n
	const cyAvg = sy / n
	const labelW = Math.max(props.cell * 1.6, px(w) * 0.9)
	const labelH = Math.min(px(h), props.cell * 1.6)
	return {
		grid,
		cells,
		edges,
		label: {
			x: Math.min(Math.max(px(x + cxAvg) - labelW / 2, px(x)), px(x + w) - labelW),
			y: Math.min(Math.max(px(y + cyAvg) - labelH / 2, px(y)), px(y + h) - labelH),
			w: labelW,
			h: labelH,
		},
	}
}

const placedRooms = computed(() =>
	props.rooms
		.filter((r) => r.plan_x != null)
		.map((r) => ({ item: r, geo: geometry({ x: r.plan_x, y: r.plan_y, w: r.plan_w, h: r.plan_h, mask: r.plan_cells }) })),
)
const shapeGeos = computed(() =>
	props.shapes.map((s) => ({ item: s, geo: geometry({ x: s.x, y: s.y, w: s.w, h: s.h, mask: s.cells }) })),
)

/* ---------- взаимодействие ---------- */
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
	const id = type === "room" ? item.id : "shape-" + item.id
	// Режим выреза: клик по клетке переключает её, а не тянет блок
	if (props.carving && mode === "move") {
		const { cx, cy } = toCells(event)
		const bx = type === "room" ? item.plan_x : item.x
		const by = type === "room" ? item.plan_y : item.y
		event.preventDefault()
		event.stopPropagation()
		emit("select", id)
		emit("carve", { type, id: item.id, cx: Math.floor(cx - bx), cy: Math.floor(cy - by) })
		return
	}
	event.preventDefault()
	event.stopPropagation()
	const { cx, cy } = toCells(event)
	const x = type === "room" ? item.plan_x : item.x
	const y = type === "room" ? item.plan_y : item.y
	const w = type === "room" ? item.plan_w : item.w
	const h = type === "room" ? item.plan_h : item.h
	drag.value = { item, type, mode, offX: cx - x, offY: cy - y, startW: w, startH: h, startCx: cx, startCy: cy, moved: false }
	emit("select", id)
	window.addEventListener("pointermove", onDrag)
	window.addEventListener("pointerup", endDrag, { once: true })
}

function onDrag(event) {
	const d = drag.value
	if (!d) return
	const { cx, cy } = toCells(event)
	d.moved = true
	const curW = d.type === "room" ? d.item.plan_w : d.item.w
	const curH = d.type === "room" ? d.item.plan_h : d.item.h
	const curX = d.type === "room" ? d.item.plan_x : d.item.x
	const curY = d.type === "room" ? d.item.plan_y : d.item.y
	if (d.mode === "move") {
		emit("move", {
			type: d.type,
			id: d.item.id,
			x: Math.max(0, Math.min(props.cols - curW, Math.round(cx - d.offX))),
			y: Math.max(0, Math.min(props.rows - curH, Math.round(cy - d.offY))),
		})
	} else {
		emit("move", {
			type: d.type,
			id: d.item.id,
			w: Math.max(1, Math.min(props.cols - curX, Math.round(d.startW + (cx - d.startCx)))),
			h: Math.max(1, Math.min(props.rows - curY, Math.round(d.startH + (cy - d.startCy)))),
		})
	}
}

function endDrag() {
	window.removeEventListener("pointermove", onDrag)
	drag.value = null
}

function onClick(item) {
	if (drag.value?.moved || props.carving) return
	emit("open", item)
}
</script>

<template>
	<div class="plan-wrap" :class="{ carving }">
		<svg ref="svg" class="plan" :viewBox="`0 0 ${width} ${height}`" :style="{ aspectRatio: `${width} / ${height}` }">
			<defs>
				<pattern id="plan-grid" :width="cell" :height="cell" patternUnits="userSpaceOnUse">
					<path :d="`M ${cell} 0 L 0 0 0 ${cell}`" fill="none" stroke="var(--plan-grid)" stroke-width="1" />
				</pattern>
			</defs>
			<rect :width="width" :height="height" fill="var(--plan-bg)" />
			<rect v-if="editable" :width="width" :height="height" fill="url(#plan-grid)" />

			<!-- Служебные помещения -->
			<g v-for="{ item: s, geo } in shapeGeos" :key="'s' + s.id" class="shape" :class="{ on: selectedId === 'shape-' + s.id, editable }">
				<rect
					v-for="(c, i) in geo.cells"
					:key="i"
					:x="c.x"
					:y="c.y"
					:width="c.w"
					:height="c.h"
					:fill="shapeMeta(s.kind).fill"
					@pointerdown="startDrag($event, s, 'shape', 'move')"
				/>
				<line
					v-for="(e, i) in geo.edges"
					:key="'e' + i"
					:x1="e.x1"
					:y1="e.y1"
					:x2="e.x2"
					:y2="e.y2"
					class="outline shape-outline"
				/>
				<foreignObject :x="geo.label.x" :y="geo.label.y" :width="geo.label.w" :height="geo.label.h" class="no-events">
					<div class="shape-label">
						<Icon :name="shapeMeta(s.kind).icon" size="0.95rem" />
						<span v-if="geo.label.w > 70">{{ s.label || shapeMeta(s.kind).label }}</span>
					</div>
				</foreignObject>
				<rect
					v-if="editable && !carving"
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
				v-for="{ item: r, geo } in placedRooms"
				:key="'r' + r.id"
				class="room"
				:class="[r.tone, { on: selectedId === r.id, editable, highlight: r.highlight }]"
			>
				<rect
					v-for="(c, i) in geo.cells"
					:key="i"
					class="cellfill"
					:x="c.x"
					:y="c.y"
					:width="c.w"
					:height="c.h"
					@pointerdown="startDrag($event, r, 'room', 'move')"
					@click="onClick(r)"
				/>
				<line v-for="(e, i) in geo.edges" :key="'e' + i" :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2" class="outline" />
				<foreignObject :x="geo.label.x" :y="geo.label.y" :width="geo.label.w" :height="geo.label.h" class="no-events">
					<div class="room-label">
						<b>{{ r.label || "№ " + r.number }}</b>
						<span v-if="r.sub && geo.label.h > 40">{{ r.sub }}</span>
						<span v-if="r.highlight" class="here">вы здесь</span>
					</div>
				</foreignObject>
				<rect
					v-if="editable && !carving"
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
.outline {
	stroke: var(--color-divider);
	stroke-width: 1.5;
	stroke-linecap: square;
}
.shape-outline {
	stroke: color-mix(in srgb, var(--color-secondary), transparent 55%);
	stroke-dasharray: 4 3;
}

/* Номера: цвет = загрузка */
.room .cellfill {
	fill: var(--color-raised-bg);
	cursor: pointer;
}
.room.free .cellfill {
	fill: color-mix(in srgb, var(--color-gray), transparent 78%);
}
.room.free .outline {
	stroke: var(--color-gray);
}
.room.part .cellfill {
	fill: color-mix(in srgb, var(--color-green), transparent 78%);
}
.room.part .outline {
	stroke: var(--color-green);
}
.room.full .cellfill {
	fill: color-mix(in srgb, var(--color-red), transparent 78%);
}
.room.full .outline {
	stroke: var(--color-red);
}
.room.repair .cellfill {
	fill: color-mix(in srgb, var(--color-orange), transparent 74%);
}
.room.repair .outline {
	stroke: var(--color-orange);
}
.room.plain .cellfill {
	fill: color-mix(in srgb, var(--color-secondary), transparent 84%);
}
.room:hover .outline {
	stroke-width: 2.5;
}
.room.on .outline {
	stroke: var(--color-brand);
	stroke-width: 3;
}
.room.highlight .cellfill {
	fill: color-mix(in srgb, var(--color-brand), transparent 62%);
}
.room.highlight .outline {
	stroke: var(--color-brand);
	stroke-width: 3;
}
.room.editable .cellfill {
	cursor: grab;
}
.carving .room.editable .cellfill,
.carving .shape.editable rect {
	cursor: crosshair;
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
.shape.editable rect {
	cursor: grab;
}
.shape.on .shape-outline {
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
