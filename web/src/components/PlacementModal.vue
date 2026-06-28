<script setup>
import { ref, onMounted, computed } from "vue"
import { api, post, put, del } from "@/api/client"
import { toast } from "@/toast"
import Modal from "@/components/Modal.vue"

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
const residentName = ref(props.existing?.resident_name || "")
const residentId = ref(props.existing?.resident_id || null)
const suggestions = ref([])
const statusId = ref(props.existing?.status_id || null)
const stage = ref(props.existing?.stage || "expected")
const dateFrom = ref(props.existing?.date_from || props.date)
const dateTo = ref(props.existing?.date_to || props.dateTo || props.date)
const comment = ref(props.existing?.comment || "")

const stageOptions = computed(() => (props.existing ? [stage.value, ...(STAGE_NEXT[props.existing.stage] || [])] : ["expected", "checked_in"]))

onMounted(async () => {
	statuses.value = await api("/statuses")
	if (!statusId.value) statusId.value = statuses.value[0]?.id
})

let timer
function onResidentInput() {
	residentId.value = null
	clearTimeout(timer)
	timer = setTimeout(async () => {
		const q = residentName.value.trim()
		if (q.length < 2) return (suggestions.value = [])
		suggestions.value = (await api("/residents?q=" + encodeURIComponent(q))).slice(0, 6)
	}, 250)
}
function pick(r) {
	residentId.value = r.id
	residentName.value = r.full_name
	suggestions.value = []
}
async function createResident() {
	const r = await post("/residents", { full_name: residentName.value.trim() })
	residentId.value = r.id
	suggestions.value = []
	toast("Проживающий создан")
}

async function save() {
	if (stage.value === "cancelled") {
		if (!confirm("Отменить эту бронь?")) return;
	} else {
		if (!residentName.value.trim()) {
			toast("Пожалуйста, введите ФИО проживающего");
			return;
		}

		if (props.existing && props.existing.resident_id) {
			if (residentName.value.trim() !== (props.existing.resident_name || "")) {
				try {
					await api(`/residents/${props.existing.resident_id}`, {
						method: "PUT",
						body: JSON.stringify({ full_name: residentName.value.trim() })
					});
					toast("Данные проживающего обновлены");
				} catch (e) {
					toast("Не удалось обновить ФИО: " + e.message);
					return;
				}
			}
		} else if (!residentId.value && residentName.value.trim()) {
			try {
				const newResident = await post("/residents", { full_name: residentName.value.trim() });
				residentId.value = newResident.id;
			} catch (e) {
				toast("Ошибка при создании проживающего: " + e.message);
				return;
			}
		}
	}

	const payload = {
		bed_id: props.bed.id,
		resident_id: residentId.value || props.existing?.resident_id,
		status_id: Number(statusId.value),
		stage: stage.value,
		date_from: dateFrom.value,
		date_to: dateTo.value,
		comment: comment.value,
	};

	try {
		if (props.existing) {
			await api(`/placements/${props.existing.id}`, { method: "PUT", body: JSON.stringify(payload) });
		} else {
			await api("/placements", { method: "POST", body: JSON.stringify(payload) });
		}
		emit("saved");
	} catch (e) {
		toast(e.message);
	}
}

async function remove() {
	if (!confirm("Удалить это размещение?")) return;
	await del("/placements/" + props.existing.id);
	emit("saved");
}
</script>

<template>
	<Modal :title="existing ? 'Размещение' : 'Новое размещение'" @close="emit('close')">
		<p class="muted" style="margin: 0">{{ bed.label }}</p>

		<div class="field">
			<label>Проживающий</label>
			<input v-model="residentName" placeholder="Начните вводить ФИО" @input="onResidentInput" />
			<div v-if="suggestions.length || (residentName.trim().length >= 2 && !exactExists && !existing)" class="suggest">
				<button v-for="s in suggestions" :key="s.id" type="button" class="sug" @click="pick(s)">
					{{ s.full_name }}<span v-if="s.tab_number" class="muted"> · {{ s.tab_number }}</span>
				</button>
				<button v-if="!exactExists && residentName.trim().length >= 2 && !existing" type="button" class="sug add" @click="createResident">
					+ Создать «{{ residentName.trim() }}»
				</button>
			</div>
		</div>

		<div class="row wrap">
			<div class="field grow"><label>Заезд</label><input v-model="dateFrom" type="date" /></div>
			<div class="field grow"><label>Выезд</label><input v-model="dateTo" type="date" /></div>
		</div>
		<div class="row wrap">
			<div class="field grow"><label>Статус</label><select v-model="statusId"><option v-for="s in statuses" :key="s.id" :value="s.id">{{ s.name }}</option></select></div>
			<div class="field grow"><label>Стадия брони</label><select v-model="stage"><option v-for="v in stageOptions" :key="v" :value="v">{{ STAGES[v] }}</option></select></div>
		</div>
		<div class="field"><label>Комментарий</label><textarea v-model="comment" rows="2" /></div>

		<template #foot>
			<button v-if="existing" class="btn btn-danger" @click="remove">Удалить</button>
			<button class="btn" @click="emit('close')">Отмена</button>
			<button class="btn btn-primary" @click="save">Сохранить</button>
		</template>
	</Modal>
</template>

<style scoped>
.suggest {
	margin-top: 4px;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	background: var(--color-bg);
	max-height: 200px;
	overflow: auto;
}
.sug {
	display: block;
	width: 100%;
	text-align: left;
	padding: var(--gap-sm) var(--gap-md);
	background: transparent;
	border: none;
	color: var(--color-base);
	font: inherit;
	cursor: pointer;
}
.sug:hover { background: var(--color-button-bg); }
.sug.add { color: var(--color-green); font-weight: 700; }
</style>