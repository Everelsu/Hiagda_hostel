<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue"
import { api, post, put, download } from "@/api/client"
import { toast } from "@/toast"
import { dateTime } from "@/utils/date"
import Icon from "@/components/Icon.vue"
import { PageHeader, Button, IconButton, DataTable, Chip, Card, Skeleton, confirm } from "@/ui"

const d = ref(null)
const creating = ref(false)
const restoring = ref("")
let poll = null

async function load() {
	d.value = await api("/admin/backups")
	// Пока идёт операция (в том числе ночной автобэкап) — обновляем сами
	clearTimeout(poll)
	if (d.value.busy) poll = setTimeout(load, 3000)
}
onMounted(load)
onUnmounted(() => clearTimeout(poll))

const items = computed(() => d.value?.items || [])
const last = computed(() => items.value.find((b) => b.complete))
const totalSize = computed(() => items.value.reduce((s, b) => s + (b.db_size || 0) + (b.files_size || 0), 0))
const pinnedCount = computed(() => items.value.filter((b) => b.pinned).length)
const busyText = computed(() => (d.value?.busy?.kind === "restore" ? "Идёт восстановление…" : d.value?.busy ? "Снимается копия…" : ""))

const columns = [
	{ key: "name", label: "Когда", sortable: true },
	{ key: "size", label: "Размер" },
	{ key: "note", label: "Откуда" },
]

// ISO и «2026-09-28 03:00:00» (UTC) — оба приводим к местному времени
const when = (iso) => new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })
function ago(iso) {
	const min = Math.round((Date.now() - new Date(iso)) / 60000)
	const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" })
	if (Math.abs(min) < 60) return rtf.format(-min, "minute")
	if (Math.abs(min) < 60 * 48) return rtf.format(-Math.round(min / 60), "hour")
	return rtf.format(-Math.round(min / 1440), "day")
}
function size(bytes) {
	if (bytes == null) return "—"
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
	return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

async function create() {
	creating.value = true
	try {
		const r = await post("/admin/backups", {})
		toast.success(`Копия ${r.name} снята`)
	} catch (e) {
		toast.error(e.message)
	} finally {
		creating.value = false
		load()
	}
}

async function togglePin(b) {
	let note = ""
	if (!b.pinned) {
		const ok = await confirm({
			title: "Закрепить копию?",
			message: "Закреплённую копию не удалит ни автоочистка, ни случайный клик. Её можно открепить в любой момент.",
			confirmLabel: "Закрепить",
		})
		if (!ok) return
		note = "закреплена вручную"
	}
	await put(`/admin/backups/${b.name}/pin`, { pinned: !b.pinned, note })
	toast.success(b.pinned ? "Копия откреплена" : "Копия закреплена")
	load()
}

async function remove(b) {
	if (b.pinned) return toast.error("Копия закреплена — сначала открепите её")
	const ok = await confirm({
		title: "Удалить копию навсегда?",
		message: `Копия от ${when(b.created_at)} будет удалена с диска. Вернуть её будет нельзя.`,
		danger: true,
		confirmLabel: "Удалить",
		typeText: b.name,
	})
	if (!ok) return
	try {
		await api(`/admin/backups/${b.name}`, { method: "DELETE", body: JSON.stringify({ confirm: b.name }) })
		toast.success("Копия удалена")
	} catch (e) {
		toast.error(e.message)
	}
	load()
}

async function restore(b) {
	const ok = await confirm({
		title: "Восстановить из этой копии?",
		message:
			`Вся база и загруженные файлы вернутся к состоянию на ${when(b.created_at)}.\n\n` +
			"Всё, что сделано после этого, пропадёт из системы — но перед восстановлением автоматически снимется и закрепится копия текущего состояния, так что откатиться можно.\n\n" +
			"Коллегам лучше на пару минут прекратить работу.",
		danger: true,
		confirmLabel: "Восстановить",
		typeText: b.name,
	})
	if (!ok) return
	restoring.value = b.name
	try {
		const r = await post(`/admin/backups/${b.name}/restore`, { confirm: b.name })
		toast.success(`Восстановлено. Прежнее состояние сохранено в ${r.safety}`)
		// Пользователи и права тоже вернулись к копии — начинаем с чистого листа
		setTimeout(() => location.reload(), 1500)
	} catch (e) {
		toast.error(e.message)
		restoring.value = ""
		load()
	}
}
</script>

<template>
	<div class="grid">
		<PageHeader title="Резервные копии" subtitle="База данных и загруженные фото — снимаются автоматически каждый день" icon="database">
			<template #actions>
				<Button icon="rotate-cw" @click="load">Обновить</Button>
				<Button variant="primary" icon="plus" :loading="creating || !!d?.busy" @click="create">Снять копию сейчас</Button>
			</template>
		</PageHeader>

		<Skeleton v-if="!d" variant="card" :count="2" />
		<template v-else>
			<div v-if="d.lastRun && !d.lastRun.ok" class="banner banner--error">
				<Icon name="alert-triangle" />
				<div>
					<b>Последняя копия не снялась</b> ({{ when(d.lastRun.at) }}, {{ d.lastRun.note }})
					<div class="banner__sub">{{ d.lastRun.error }}</div>
				</div>
			</div>
			<div v-if="busyText" class="banner banner--busy"><span class="spin" /> {{ busyText }}</div>

			<div class="kpis">
				<div class="kpi" :class="{ warn: !last }">
					<div class="kpi__label">Последняя копия</div>
					<div class="kpi__value">{{ last ? ago(last.created_at) : "ещё не было" }}</div>
					<div class="kpi__sub">{{ last ? when(last.created_at) : "Снимите первую прямо сейчас" }}</div>
				</div>
				<div class="kpi">
					<div class="kpi__label">Следующая автокопия</div>
					<div class="kpi__value">{{ d.schedule.next ? when(d.schedule.next).split(", ")[1] || when(d.schedule.next) : "выключена" }}</div>
					<div class="kpi__sub">{{ d.schedule.next ? when(d.schedule.next) : "BACKUP_AT=off" }}</div>
				</div>
				<div class="kpi">
					<div class="kpi__label">Хранится</div>
					<div class="kpi__value">{{ items.length }} <span class="kpi__unit">копий</span></div>
					<div class="kpi__sub">автоочистка оставляет {{ d.schedule.keep }} · закреплено {{ pinnedCount }}</div>
				</div>
				<div class="kpi">
					<div class="kpi__label">Занимают</div>
					<div class="kpi__value">{{ size(totalSize) }}</div>
					<div class="kpi__sub mono" :title="d.schedule.dir">{{ d.schedule.dir }}</div>
				</div>
			</div>

			<Card pad="md" class="safety">
				<Icon name="shield-check" size="1.4rem" />
				<ul>
					<li>Перед восстановлением <b>автоматически снимается и закрепляется</b> копия текущего состояния — любое восстановление можно откатить.</li>
					<li>Удаление и восстановление требуют ввести имя копии. Закреплённую и единственную копию удалить нельзя.</li>
					<li>Копии лежат на этом же сервере. Раз в неделю <b>скачивайте архив</b> и храните его в другом месте.</li>
				</ul>
			</Card>

			<DataTable :columns="columns" :rows="items" row-key="name" empty-title="Копий пока нет" empty-text="Нажмите «Снять копию сейчас»" empty-icon="database">
				<template #cell-name="{ row }">
					<div class="when">
						<b class="contrast">{{ when(row.created_at) }}</b>
						<span class="muted mono">{{ row.name }}</span>
					</div>
				</template>
				<template #cell-size="{ row }">
					<span class="nowrap">{{ size(row.db_size) }}</span>
					<span v-if="row.files_size" class="muted nowrap"> + фото {{ size(row.files_size) }}</span>
				</template>
				<template #cell-note="{ row }">
					<div class="row wrap" style="gap: 6px">
						<Chip v-if="!row.complete" color="var(--color-red)" dot>неполная</Chip>
						<Chip v-if="row.pinned" color="var(--color-brand)"><Icon name="lock" size="0.9em" /> закреплена</Chip>
						<span class="muted note">{{ row.pin_note && row.pin_note !== "закреплена вручную" ? row.pin_note : row.note || "—" }}</span>
					</div>
				</template>
				<template #actions="{ row }">
					<div class="acts">
						<IconButton icon="download" label="Скачать архив" size="sm" @click="download(`/admin/backups/${row.name}/download`)" />
						<IconButton :icon="row.pinned ? 'lock' : 'pin'" :label="row.pinned ? 'Открепить' : 'Закрепить'" size="sm" @click="togglePin(row)" />
						<Button size="sm" icon="rotate-ccw" :disabled="!row.complete || !!d.busy" :loading="restoring === row.name" @click="restore(row)">Восстановить</Button>
						<IconButton icon="trash" label="Удалить" size="sm" variant="danger" :disabled="row.pinned" @click="remove(row)" />
					</div>
				</template>
			</DataTable>
		</template>

		<Teleport to="body">
			<div v-if="restoring" class="restore-veil">
				<div class="restore-veil__box">
					<span class="spin spin--lg" />
					<b>Восстанавливаем данные…</b>
					<span class="muted">Не закрывайте страницу. Обычно это занимает меньше минуты.</span>
				</div>
			</div>
		</Teleport>
	</div>
</template>

<style scoped>
.kpis {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: var(--gap-md);
}
.kpi {
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	padding: var(--gap-md) var(--gap-lg);
	min-width: 0;
}
.kpi.warn {
	border-color: var(--color-orange);
}
.kpi__label {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	text-transform: uppercase;
	letter-spacing: 0.04em;
	font-weight: var(--font-weight-bold);
}
.kpi__value {
	margin-top: 4px;
	font-size: var(--font-size-lg);
	font-weight: var(--font-weight-extrabold);
	color: var(--color-contrast);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.kpi__unit {
	font-size: var(--font-size-sm);
	color: var(--color-secondary);
	font-weight: var(--font-weight-bold);
}
.kpi__sub {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.mono {
	font-family: var(--font-mono, ui-monospace, monospace);
	font-size: var(--font-size-xs);
}
.safety {
	display: flex;
	gap: var(--gap-md);
	align-items: flex-start;
	color: var(--color-green);
}
.safety ul {
	margin: 0;
	padding-left: 1.1em;
	color: var(--color-base);
	font-size: var(--font-size-sm);
	display: grid;
	gap: 4px;
}
.banner {
	display: flex;
	gap: var(--gap-md);
	align-items: center;
	padding: var(--gap-md) var(--gap-lg);
	border-radius: var(--radius-md);
	font-size: var(--font-size-sm);
}
.banner--error {
	background: var(--color-red-bg);
	color: var(--color-red);
	border: 1px solid var(--color-red);
}
.banner--busy {
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	font-weight: var(--font-weight-bold);
}
.banner__sub {
	color: var(--color-base);
	margin-top: 2px;
	font-family: var(--font-mono, ui-monospace, monospace);
	font-size: var(--font-size-xs);
}
.when {
	display: grid;
}
.note {
	font-size: var(--font-size-sm);
}
.acts {
	display: inline-flex;
	gap: 4px;
	align-items: center;
}
.spin {
	width: 1em;
	height: 1em;
	border: 2px solid currentColor;
	border-right-color: transparent;
	border-radius: 50%;
	animation: spin 0.7s linear infinite;
	flex-shrink: 0;
}
.spin--lg {
	width: 2rem;
	height: 2rem;
	border-width: 3px;
	color: var(--color-brand);
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
.restore-veil {
	position: fixed;
	inset: 0;
	z-index: calc(var(--z-modal) + 1);
	display: grid;
	place-items: center;
	background: rgba(0, 0, 0, 0.6);
	backdrop-filter: blur(3px);
}
.restore-veil__box {
	display: grid;
	justify-items: center;
	gap: var(--gap-sm);
	text-align: center;
	padding: var(--gap-xl);
	max-width: 340px;
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	color: var(--color-contrast);
}
@media (max-width: 1000px) {
	.kpis {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
