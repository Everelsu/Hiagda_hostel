<script setup>
import { ref, onMounted, computed } from "vue"
import { api, post, del } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import Modal from "@/components/Modal.vue"
import PlacementModal from "@/components/PlacementModal.vue"
import Icon from "@/components/Icon.vue"

const auth = useAuthStore()
const canEdit = auth.can("editor")
const hotels = ref([])
const hotelId = ref(null)
const date = ref(new Date().toISOString().slice(0, 10))
const rooms = ref([])
const roomDetail = ref(null)
const placement = ref(null)
const blocks = ref([])
const blockForm = ref({ date_from: "", date_to: "", reason: "" })

const roomIssues = ref([])

const activeIssues = computed(() => {
	if (!roomIssues.value) return []
	return roomIssues.value.filter(x => x.status !== 'Починено')
})

async function openRoom(r) {
	roomDetail.value = r
	blockForm.value = { date_from: date.value, date_to: date.value, reason: "" }
	blocks.value = canEdit ? await api(`/rooms/${r.id}/blocks`) : []
	try {
		roomIssues.value = await api(`/rooms/${r.id}/issues`)
	} catch (e) {
		roomIssues.value = []
	}
}

async function updateIssueStatus(issue, newStatus) {
	try {
		await api(`/issues/${issue.id}/status`, {
			method: "PUT",
			body: JSON.stringify({ status: newStatus })
		})
		roomIssues.value = await api(`/rooms/${roomDetail.value.id}/issues`)
		await load()

		// ДОБАВЛЕНО: Принудительно уменьшаем счётчик в меню или запрашиваем актуальный с сервера
		const res = await api("/me/issues/count")
		auth.newIssuesCount = res.count

		toast(`Статус изменен: "${newStatus}"`)
	} catch (e) {
		toast(e.message)
	}
}

async function addBlock() {
	try {
		await post(`/rooms/${roomDetail.value.id}/blocks`, blockForm.value)
		blocks.value = await api(`/rooms/${roomDetail.value.id}/blocks`)
		blockForm.value = { date_from: date.value, date_to: date.value, reason: "" }
		await load()
		toast("Номер поставлен на ремонт")
	} catch (e) {
		toast(e.message)
	}
}

async function removeBlock(b) {
	await del("/blocks/" + b.id)
	blocks.value = await api(`/rooms/${roomDetail.value.id}/blocks`)
	await load()
}

onMounted(async () => {
	hotels.value = await api("/hotels")
	hotelId.value = hotels.value[0]?.id
	await load()
})

async function load() {
	if (!hotelId.value) return
	const r = await api(`/plan?hotel_id=${hotelId.value}&date=${date.value}`)
	rooms.value = r.rooms
	if (roomDetail.value) roomDetail.value = rooms.value.find((x) => x.id === roomDetail.value.id) || null
}

const floors = computed(() => {
	const map = {}
	for (const r of rooms.value) (map[r.floor ?? "—"] ||= []).push(r)
	return Object.entries(map)
})

function tileClass(r) {
	if (r.occupied === 0) return "free"
	if (r.occupied >= r.capacity) return "full"
	return "part"
}

function openBed(bed) {
	if (!canEdit) return
	placement.value = { bed, existing: bed.placement }
}
</script>

<template>
	<div class="grid">
		<h1>План этажа</h1>
		<div class="row wrap">
			<select v-model="hotelId" style="width: auto" @change="load"><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></select>
			<input v-model="date" type="date" style="width: auto" @change="load" />
		</div>

		<div class="legend row wrap">
			<span class="chip"><span class="dot" style="background: var(--color-gray)" /> Свободно</span>
			<span class="chip"><span class="dot" style="background: var(--color-green)" /> Частично</span>
			<span class="chip"><span class="dot" style="background: var(--color-red)" /> Занят</span>
		</div>

		<div v-for="[floor, list] in floors" :key="floor" class="card">
			<div class="section-title">Этаж {{ floor }} <span class="muted" style="font-weight: 400">· {{ list.length }} ном.</span></div>
			<div class="tiles">
				<button
          v-for="r in list"
          :key="r.id"
          class="tile"
          :class="[tileClass(r), { blocked: r.block, service: r.has_fixing_issues }]"
          @click="openRoom(r)"
        >
          <div class="num">
            № {{ r.number }}
            <Icon v-if="r.block" name="wrench" class="wrench" title="На ремонте" />

            <Icon v-if="r.has_fixing_issues" name="clock" class="service-icon" title="На обслуживании (текущий ремонт)" />

            <span v-if="r.has_new_issues" class="issue-badge-alert" title="Есть новые жалобы от жильцов!">
              ⚠️ {{ r.has_new_issues }}
            </span>
          </div>
          <div class="sub">{{ r.class_name || "—" }} · {{ r.occupied }}/{{ r.capacity }}</div>
          <div class="beds"><span v-for="b in r.beds" :key="b.id" class="bd" :style="{ background: b.placement ? b.placement.status_color : 'transparent' }" /></div>
        </button>

			</div>
		</div>

		<Modal v-if="roomDetail" :title="'Номер № ' + roomDetail.number" @close="roomDetail = null">
			<p class="muted" style="margin: 0">Занято {{ roomDetail.occupied }} из {{ roomDetail.capacity }} · {{ date }}</p>
			<div v-if="roomDetail.block" class="block-note"><Icon name="wrench" /> На ремонте: {{ roomDetail.block.date_from }} – {{ roomDetail.block.date_to }}<template v-if="roomDetail.block.reason"> · {{ roomDetail.block.reason }}</template></div>

			<div class="grid" style="gap: var(--gap-sm)">
				<button v-for="b in roomDetail.beds" :key="b.id" class="bedrow" @click="openBed(b)">
					<span class="dot" :style="{ background: b.placement ? b.placement.status_color : 'var(--color-gray)' }" />
					<span class="grow">
						<b>{{ b.label }}</b> —
						<template v-if="b.placement">{{ b.placement.resident_name || b.placement.status_name }} <span class="muted">({{ b.placement.date_from }} – {{ b.placement.date_to }})</span></template>
						<template v-else><span class="muted">свободно</span></template>
					</span>
					<Icon v-if="canEdit" name="pencil" class="muted" />
				</button>
			</div>

			<div class="section-title" style="font-size: var(--font-size-nm); margin-top: var(--gap-md)">
				Заявки и жалобы жильцов ({{ activeIssues.length }})
			</div>

			<div v-if="!activeIssues.length" class="muted" style="font-size: var(--font-size-sm)">
				Активных жалоб от жильцов нет.
			</div>

			<div v-else class="grid" style="gap: var(--gap-xs); margin-bottom: var(--gap-md)">
				<div v-for="issue in activeIssues" :key="issue.id" class="issue-row" :class="issue.status">
					<div class="grow">
						<div style="font-weight: 700; font-size: var(--font-size-sm)">
							{{ issue.amenity_name }} <span class="issue-badge">{{ issue.status }}</span>
						</div>
						<div style="font-size: 13px; color: var(--color-base); margin-top: 2px;">{{ issue.comment }}</div>
						<div class="muted" style="font-size: 10px; margin-top: 2px;">От: {{ issue.user_name || 'Вахтовик' }} · {{ issue.created_at }}</div>
					</div>
					<div class="row" style="gap: 4px">
						<button v-if="issue.status === 'Новая'" class="btn btn-sm" style="padding: 4px 8px; font-size: 11px" @click="updateIssueStatus(issue, 'В работе')">В работу</button>
						<button v-if="issue.status !== 'Починено'" class="btn btn-sm" style="padding: 4px 8px; font-size: 11px; background: var(--color-green); color: #000" @click="updateIssueStatus(issue, 'Починено')">Починено</button>
					</div>
				</div>
			</div>

			<template v-if="canEdit">
				<div class="section-title" style="font-size: var(--font-size-nm); margin-top: var(--gap-md)">Ремонт / блокировка</div>
				<div v-for="b in blocks" :key="b.id" class="bedrow">
					<span class="grow"><Icon name="wrench" /> {{ b.date_from }} – {{ b.date_to }}<template v-if="b.reason"> · {{ b.reason }}</template></span>
					<button class="btn btn-sm btn-danger" @click="removeBlock(b)"><Icon name="x" /></button>
				</div>
				<div class="row wrap" style="margin-top: var(--gap-sm)">
					<input v-model="blockForm.date_from" type="date" style="width: auto" />
					<input v-model="blockForm.date_to" type="date" style="width: auto" />
					<input v-model="blockForm.reason" placeholder="Причина" style="min-width: 120px" />
					<button class="btn btn-sm" @click="addBlock">На ремонт</button>
				</div>
			</template>
		</Modal>
	</div>
</template>

<style scoped>
.tiles {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
	gap: var(--gap-md);
}
.tile {
	text-align: left;
	border: 1px solid var(--color-divider);
	border-left: 4px solid var(--color-gray);
	border-radius: var(--radius-md);
	background: var(--color-bg);
	padding: var(--gap-md);
	cursor: pointer;
	font: inherit;
	color: var(--color-base);
}
.tile.free {
	border-left-color: var(--color-gray);
}
.tile.part {
	border-left-color: var(--color-green);
}
.tile.full {
	border-left-color: var(--color-red);
}
.tile.blocked {
	border-left-color: var(--color-orange);
	opacity: 0.85;
}
.block-note {
	background: var(--color-red-bg);
	border: 1px solid var(--color-orange);
	border-radius: var(--radius-md);
	padding: var(--gap-sm) var(--gap-md);
	font-size: var(--font-size-sm);
}
.tile:hover {
	border-color: var(--color-brand);
}
.num {
	font-weight: 800;
	color: var(--color-contrast);
}
.sub {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.beds {
	display: flex;
	gap: 3px;
	margin-top: var(--gap-sm);
}
.bd {
	flex: 1;
	height: 6px;
	border-radius: 3px;
	border: 1px solid var(--color-divider);
}
.bedrow {
	display: flex;
	gap: var(--gap-sm);
	align-items: center;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	cursor: pointer;
	font: inherit;
	color: var(--color-base);
	text-align: left;
}
.bedrow:hover {
	border-color: var(--color-brand);
}
.bedrow .dot {
	width: 12px;
	height: 12px;
	border-radius: var(--radius-max);
	flex-shrink: 0;
}
.legend .dot {
	width: 10px;
	height: 10px;
	border-radius: var(--radius-max);
}
.issue-badge-alert {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	background: var(--color-red, #ff5c5c);
	color: #ffffff !important;
	font-size: 11px;
	font-weight: 700;
	padding: 2px 6px;
	border-radius: 10px;
	margin-left: 6px;
	vertical-align: middle;
	line-height: 1;
	animation: alert-pulse 2s infinite;
}
@keyframes alert-pulse {
	0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(255, 92, 92, 0.7); }
	70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(255, 92, 92, 0); }
	100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(255, 92, 92, 0); }
}
.issue-row {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-left: 4px solid var(--color-gray);
	border-radius: var(--radius-md);
	text-align: left;
}
.issue-row.Новая { border-left-color: var(--color-red, #ff5c5c); background: var(--color-red-bg, #fff5f5); }
.issue-row.В\ работе { border-left-color: var(--color-orange, #ff9f43); background: #fffbef; }
.issue-row.Починено { border-left-color: var(--color-green, #1bd96a); opacity: 0.6; }
.issue-badge { font-size: 10px; padding: 1px 5px; background: var(--color-button-bg); border-radius: var(--radius-sm); margin-left: 6px; font-weight: 400; }
.tile .num {
	display: flex;
	align-items: center;       /* Выравнивает по центру вертикали */
	justify-content: center;   /* Центрирует внутри плитки */
	gap: 6px;                  /* Аккуратный отступ между номером и бэджем */
	font-weight: 700;
	font-size: var(--font-size-nm, 16px);
	line-height: 1;
}

/* Корректируем сам бэдж, чтобы он не раздувал плитку по высоте */
.issue-badge-alert {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	background: var(--color-red, #ff5c5c);
	color: #ffffff !important;
	font-size: 11px;
	font-weight: 700;
	padding: 2px 6px;
	border-radius: 10px;
	line-height: 1;
	height: 18px;              /* Жесткая высота, чтобы бэдж был аккуратным */
	flex-shrink: 0;            /* Запрещаем бэджу сжиматься */
	animation: alert-pulse 2s infinite;
}

.tile.service {
	border-left: 4px solid var(--color-brand, #7a5cff) !important;
}

.service-icon {
	color: var(--color-brand, #7a5cff);
	margin-left: 6px;
	font-size: 14px;
	vertical-align: middle;
}
</style>
