<script setup>
import { ref, onMounted, computed } from "vue"
import { api, post, put, del } from "@/api/client"
import { toast } from "@/toast"
import Modal from "@/components/Modal.vue"
import { Field, Input, Select, Textarea, Button, Avatar, Chip, confirm } from "@/ui"

const props = defineProps({
	bed: { type: Object, required: true },
	existing: { type: Object, default: null },
	date: { type: String, required: true },
	dateTo: { type: String, default: null },
})
const emit = defineEmits(["saved", "close"])

const STAGES = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }
const STAGE_NEXT = { expected: ["checked_in", "cancelled"], checked_in: ["checked_out", "cancelled"], checked_out: ["checked_in"], cancelled: ["expected"] }

const statuses = ref([])
const selected = ref(props.existing?.resident_id ? { id: props.existing.resident_id, full_name: props.existing.resident_name } : null)
const query = ref("")
const suggestions = ref([])
const statusId = ref(props.existing?.status_id || null)
const stage = ref(props.existing?.stage || "expected")
const dateFrom = ref(props.existing?.date_from || props.date)
const dateTo = ref(props.existing?.date_to || props.dateTo || props.date)
const comment = ref(props.existing?.comment || "")
const busy = ref(false)

const stageOptions = computed(() => (props.existing ? [stage.value, ...(STAGE_NEXT[props.existing.stage] || [])] : ["expected", "checked_in"]))
const canCreate = computed(() => {
	const q = query.value.trim()
	return q.length >= 2 && !suggestions.value.some((s) => s.full_name.trim().toLowerCase() === q.toLowerCase())
})

onMounted(async () => {
	// Только статусы брони: «Свободно» и «Ремонт» — производные состояния, их не назначают человеку
	statuses.value = (await api("/statuses")).filter((s) => s.kind !== "system")
	if (!statusId.value || !statuses.value.some((s) => s.id === statusId.value)) statusId.value = statuses.value[0]?.id
	// подтянуть детали уже привязанного профиля (табельный, организация, доступ)
	if (selected.value?.id) {
		try {
			const list = await api("/residents?q=" + encodeURIComponent(selected.value.full_name || ""))
			const full = list.find((r) => r.id === selected.value.id)
			if (full) selected.value = full
		} catch {}
	}
})

let timer
function onSearch() {
	clearTimeout(timer)
	timer = setTimeout(async () => {
		const q = query.value.trim()
		if (q.length < 2) return (suggestions.value = [])
		suggestions.value = (await api("/residents?q=" + encodeURIComponent(q))).slice(0, 8)
	}, 220)
}
function select(r) {
	selected.value = r
	query.value = ""
	suggestions.value = []
}
function clearSelection() {
	selected.value = null
	query.value = ""
	suggestions.value = []
}
async function createAndSelect() {
	try {
		const r = await post("/residents", { full_name: query.value.trim() })
		select({ id: r.id, full_name: query.value.trim() })
		toast.success("Профиль создан")
	} catch (e) {
		toast.error(e.message)
	}
}

async function save() {
	if (stage.value === "cancelled") {
		if (!(await confirm({ title: "Отменить бронь?", danger: true, confirmLabel: "Отменить бронь" }))) return
	} else if (!selected.value?.id) {
		return toast.error("Выберите профиль вахтовика")
	}
	const payload = {
		bed_id: props.bed.id,
		resident_id: selected.value?.id || props.existing?.resident_id || null,
		status_id: Number(statusId.value),
		stage: stage.value,
		date_from: dateFrom.value,
		date_to: dateTo.value,
		comment: comment.value,
	}
	busy.value = true
	try {
		if (props.existing) await put(`/placements/${props.existing.id}`, payload)
		else await post("/placements", payload)
		emit("saved")
	} catch (e) {
		toast.error(e.message)
	} finally {
		busy.value = false
	}
}

async function remove() {
	if (!(await confirm({ title: "Удалить размещение?", danger: true, confirmLabel: "Удалить" }))) return
	await del("/placements/" + props.existing.id)
	emit("saved")
}
</script>

<template>
	<Modal :title="existing ? 'Размещение' : 'Новое размещение'" @close="emit('close')">
		<p class="muted" style="margin: 0">{{ bed.label }}</p>

		<Field label="Профиль вахтовика">
			<div v-if="selected" class="picked">
				<Avatar :name="selected.full_name" size="2.2rem" />
				<div class="grow">
					<div class="contrast" style="font-weight: 700">{{ selected.full_name }}</div>
					<div class="muted" style="font-size: var(--font-size-xs)">{{ [selected.tab_number, selected.company].filter(Boolean).join(" · ") || "профиль" }}</div>
				</div>
				<Chip v-if="selected.account_username" color="var(--color-green)" dot>есть доступ</Chip>
				<Button variant="ghost" size="sm" @click="clearSelection">Сменить</Button>
			</div>
			<template v-else>
				<Input v-model="query" placeholder="Поиск по ФИО / табельному №…" @input="onSearch" />
				<div v-if="suggestions.length || canCreate" class="suggest">
					<button v-for="s in suggestions" :key="s.id" type="button" class="sug" @click="select(s)">
						<span class="contrast">{{ s.full_name }}</span>
						<span class="muted"><template v-if="s.tab_number"> · {{ s.tab_number }}</template><template v-if="s.company"> · {{ s.company }}</template></span>
					</button>
					<button v-if="canCreate" type="button" class="sug add" @click="createAndSelect">+ Создать профиль «{{ query.trim() }}»</button>
				</div>
				<p class="muted" style="font-size: var(--font-size-xs); margin: 4px 0 0">Бронь привязывается к профилю. Доступ в кабинет выдаётся отдельно в разделе «Профили».</p>
			</template>
		</Field>

		<div class="two">
			<Field label="Заезд"><Input v-model="dateFrom" type="date" /></Field>
			<Field label="Выезд"><Input v-model="dateTo" type="date" /></Field>
		</div>
		<div class="two">
			<Field label="Статус"><Select v-model="statusId"><option v-for="s in statuses" :key="s.id" :value="s.id">{{ s.name }}</option></Select></Field>
			<Field label="Стадия брони"><Select v-model="stage"><option v-for="v in stageOptions" :key="v" :value="v">{{ STAGES[v] }}</option></Select></Field>
		</div>
		<Field label="Комментарий"><Textarea v-model="comment" :rows="2" /></Field>

		<template #foot>
			<Button v-if="existing" variant="danger" @click="remove">Удалить</Button>
			<Button variant="ghost" @click="emit('close')">Отмена</Button>
			<Button variant="primary" :loading="busy" @click="save">Сохранить</Button>
		</template>
	</Modal>
</template>

<style scoped>
.two {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-md);
}
.picked {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.suggest {
	margin-top: 4px;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	background: var(--color-bg);
	max-height: 220px;
	overflow: auto;
}
.sug {
	display: block;
	width: 100%;
	text-align: left;
	padding: var(--gap-sm) var(--gap-md);
	background: transparent;
	border: none;
	font: inherit;
	cursor: pointer;
}
.sug:hover {
	background: var(--color-button-bg);
}
.sug.add {
	color: var(--color-brand);
	font-weight: 700;
}
</style>
