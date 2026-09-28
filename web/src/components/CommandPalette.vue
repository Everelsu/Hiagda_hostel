<script setup>
// Быстрый переход: Ctrl+K (или «/») — разделы, вахтовики по ФИО/табельному, действия.
import { ref, computed, watch, nextTick } from "vue"
import { useRouter } from "vue-router"
import { api } from "@/api/client"
import Icon from "@/components/Icon.vue"

const props = defineProps({
	pages: { type: Array, default: () => [] }, // [{ to, icon, label, group }]
	actions: { type: Array, default: () => [] }, // [{ id, icon, label, run }]
	searchResidents: Boolean,
})
const open = defineModel({ type: Boolean, default: false })
const router = useRouter()

const q = ref("")
const active = ref(0)
const input = ref(null)
const people = ref([])
let timer

const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е")

const results = computed(() => {
	const n = norm(q.value.trim())
	const match = (label, extra = "") => !n || norm(label + " " + extra).includes(n)
	const pages = props.pages
		.filter((p) => match(p.label, p.group))
		.map((p) => ({ key: "p" + p.to, icon: p.icon, label: p.label, hint: p.group, run: () => router.push(p.to) }))
	const acts = props.actions
		.filter((a) => match(a.label))
		.map((a) => ({ key: "a" + a.id, icon: a.icon, label: a.label, hint: "действие", run: a.run }))
	const ppl = people.value.map((r) => ({
		key: "r" + r.id,
		icon: "user",
		label: r.full_name,
		hint: [r.tab_number, r.department].filter(Boolean).join(" · ") || "вахтовик",
		run: () => router.push({ path: "/app/profiles", query: { open: r.id } }),
	}))
	return [...ppl, ...pages, ...acts]
})

watch(open, async (v) => {
	if (!v) return
	q.value = ""
	people.value = []
	active.value = 0
	await nextTick()
	input.value?.focus()
})
watch(q, (v) => {
	active.value = 0
	clearTimeout(timer)
	if (!props.searchResidents || v.trim().length < 2) return (people.value = [])
	timer = setTimeout(async () => {
		try {
			people.value = (await api("/residents?q=" + encodeURIComponent(v.trim()))).slice(0, 6)
		} catch {
			people.value = []
		}
	}, 200)
})

function choose(item) {
	if (!item) return
	open.value = false
	item.run()
}
function onKey(e) {
	const n = results.value.length
	if (e.key === "ArrowDown") (active.value = (active.value + 1) % Math.max(n, 1)), e.preventDefault()
	else if (e.key === "ArrowUp") (active.value = (active.value - 1 + n) % Math.max(n, 1)), e.preventDefault()
	else if (e.key === "Enter") choose(results.value[active.value])
	else if (e.key === "Escape") open.value = false
}
</script>

<template>
	<Teleport to="body">
		<div v-if="open" class="cp" @keydown="onKey">
			<div class="cp__scrim" @click="open = false" />
			<div class="cp__box" role="dialog" aria-label="Быстрый переход">
				<div class="cp__search">
					<Icon name="search" />
					<input ref="input" v-model="q" placeholder="Раздел, вахтовик или действие…" autocomplete="off" spellcheck="false" />
					<kbd>Esc</kbd>
				</div>
				<ul class="cp__list" role="listbox">
					<li
						v-for="(r, i) in results"
						:key="r.key"
						role="option"
						:aria-selected="i === active"
						class="cp__item"
						:class="{ on: i === active }"
						@mousemove="active = i"
						@click="choose(r)"
					>
						<Icon :name="r.icon" />
						<span class="cp__label">{{ r.label }}</span>
						<span class="cp__hint">{{ r.hint }}</span>
						<Icon v-if="i === active" name="corner-down-left" class="cp__enter" />
					</li>
					<li v-if="!results.length" class="cp__empty">Ничего не найдено</li>
				</ul>
				<div class="cp__foot"><kbd>↑</kbd><kbd>↓</kbd> выбор <kbd>Enter</kbd> открыть <span class="grow" /> <kbd>Ctrl</kbd>+<kbd>K</kbd> в любом месте</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.cp {
	position: fixed;
	inset: 0;
	z-index: var(--z-modal);
	display: flex;
	justify-content: center;
	align-items: flex-start;
	padding: 12vh var(--gap-lg) var(--gap-lg);
}
.cp__scrim {
	position: absolute;
	inset: 0;
	background: rgba(0, 0, 0, 0.5);
	backdrop-filter: blur(2px);
	animation: cp-fade var(--speed) ease;
}
.cp__box {
	position: relative;
	width: 100%;
	max-width: 560px;
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	box-shadow: var(--shadow-floating), 0 24px 60px rgba(0, 0, 0, 0.35);
	overflow: hidden;
	animation: cp-pop var(--speed) ease;
}
.cp__search {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-md) var(--gap-lg);
	border-bottom: 1px solid var(--color-divider);
	color: var(--color-secondary);
}
.cp__search input {
	flex: 1;
	min-width: 0;
	border: none;
	outline: none;
	background: transparent;
	color: var(--color-contrast);
	font: inherit;
	font-size: var(--font-size-nm);
}
.cp__list {
	list-style: none;
	margin: 0;
	padding: var(--gap-xs);
	max-height: min(52vh, 420px);
	overflow-y: auto;
}
.cp__item {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	cursor: pointer;
	color: var(--color-base);
	font-size: var(--font-size-sm);
}
.cp__item.on {
	background: var(--color-brand-highlight);
	color: var(--color-contrast);
}
.cp__item.on :deep(svg) {
	color: var(--color-brand);
}
.cp__label {
	font-weight: var(--font-weight-medium);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.cp__hint {
	flex: 1;
	min-width: 0;
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.cp__enter {
	color: var(--color-secondary);
}
.cp__empty {
	padding: var(--gap-lg);
	text-align: center;
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
}
.cp__foot {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: var(--gap-sm) var(--gap-lg);
	border-top: 1px solid var(--color-divider);
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
}
kbd {
	display: inline-grid;
	place-items: center;
	min-width: 1.5em;
	padding: 0 5px;
	border: 1px solid var(--color-button-border);
	border-bottom-width: 2px;
	border-radius: 5px;
	background: var(--color-bg);
	font-family: inherit;
	font-size: 0.7rem;
	line-height: 1.5;
	color: var(--color-secondary);
}
@keyframes cp-fade {
	from {
		opacity: 0;
	}
}
@keyframes cp-pop {
	from {
		opacity: 0;
		transform: translateY(-6px) scale(0.98);
	}
}
@media (max-width: 560px) {
	.cp__foot {
		display: none;
	}
}
</style>
