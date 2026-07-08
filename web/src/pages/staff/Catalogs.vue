<script setup>
import { ref, onMounted } from "vue"
import { api, post, del } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import { amenityIcon } from "@/icons"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, Input, Select, Button, IconButton, ListRow, StatusDot, confirm } from "@/ui"

const auth = useAuthStore()
const canEdit = auth.can("editor")
const canAdmin = auth.can("admin")

const classes = ref([])
const statuses = ref([])
const amenities = ref([])

const newClass = ref("")
const newStatus = ref({ name: "", color: "#1bd96a" })
const newAmenity = ref({ name: "", icon: "dot", scope: "both" })
const ICON_OPTIONS = ["dot", "wifi", "tv", "shower", "fridge", "snow", "utensils", "washer", "wind", "dumbbell", "sofa"]

onMounted(async () => {
	;[classes.value, statuses.value, amenities.value] = await Promise.all([api("/classes"), api("/statuses"), api("/amenities")])
})

async function addClass() {
	if (!newClass.value.trim()) return
	try {
		await post("/classes", { name: newClass.value.trim() })
		newClass.value = ""
		classes.value = await api("/classes")
	} catch (e) {
		toast.error(e.message)
	}
}
async function removeClass(c) {
	if (!(await confirm({ title: `Удалить тип «${c.name}»?`, danger: true, confirmLabel: "Удалить" }))) return
	try {
		await del("/classes/" + c.id)
		classes.value = await api("/classes")
	} catch (e) {
		toast.error(e.message)
	}
}
async function addStatus() {
	if (!newStatus.value.name) return
	try {
		await post("/statuses", { ...newStatus.value, sort: statuses.value.length })
		newStatus.value = { name: "", color: "#1bd96a" }
		statuses.value = await api("/statuses")
	} catch (e) {
		toast.error(e.message)
	}
}
async function removeStatus(s) {
	if (!(await confirm({ title: `Удалить статус «${s.name}»?`, danger: true, confirmLabel: "Удалить" }))) return
	try {
		await del("/statuses/" + s.id)
		statuses.value = await api("/statuses")
	} catch (e) {
		toast.error(e.message)
	}
}
async function addAmenity() {
	if (!newAmenity.value.name) return
	try {
		await post("/amenities", { ...newAmenity.value })
		newAmenity.value = { name: "", icon: "dot", scope: "both" }
		amenities.value = await api("/amenities")
	} catch (e) {
		toast.error(e.message)
	}
}
async function removeAmenity(a) {
	if (!(await confirm({ title: `Удалить удобство «${a.name}»?`, danger: true, confirmLabel: "Удалить" }))) return
	await del("/amenities/" + a.id)
	amenities.value = await api("/amenities")
}
const SCOPE = { both: "везде", room: "номер", hotel: "дом" }
</script>

<style scoped>
.cat-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	gap: var(--gap-lg);
	align-items: start;
}
</style>

<template>
	<div class="grid">
		<PageHeader title="Справочники" subtitle="Типы номеров, статусы и каталог удобств" icon="tag" />

		<div class="cat-grid">
			<Card title="Типы номеров">
				<div class="grid" style="gap: var(--gap-sm)">
					<ListRow v-for="c in classes" :key="c.id">
						<template #title>{{ c.name }}</template>
						<template #trail><IconButton v-if="canAdmin" icon="trash" label="Удалить" size="sm" variant="danger" @click="removeClass(c)" /></template>
					</ListRow>
				</div>
				<div v-if="canEdit" class="row" style="margin-top: var(--gap-md)"><Input v-model="newClass" placeholder="Новый тип" @keyup.enter="addClass" /><Button icon="plus" @click="addClass" /></div>
			</Card>

			<Card title="Статусы номеров">
				<div class="grid" style="gap: var(--gap-sm)">
					<ListRow v-for="s in statuses" :key="s.id">
						<template #lead><StatusDot :color="s.color" size="14px" /></template>
						<template #title>{{ s.name }}</template>
						<template #trail><IconButton v-if="canAdmin" icon="trash" label="Удалить" size="sm" variant="danger" @click="removeStatus(s)" /></template>
					</ListRow>
				</div>
				<div v-if="canEdit" class="row" style="margin-top: var(--gap-md)">
					<Input v-model="newStatus.name" placeholder="Название" />
					<input v-model="newStatus.color" type="color" style="width: 48px; padding: 2px; height: var(--control-h-md)" />
					<Button icon="plus" @click="addStatus" />
				</div>
			</Card>

			<Card title="Каталог удобств">
				<div class="grid" style="gap: var(--gap-sm)">
					<ListRow v-for="a in amenities" :key="a.id">
						<template #lead><Icon :name="amenityIcon(a.icon)" /></template>
						<template #title>{{ a.name }}</template>
						<template #sub>{{ SCOPE[a.scope] || a.scope }}</template>
						<template #trail><IconButton v-if="canAdmin" icon="trash" label="Удалить" size="sm" variant="danger" @click="removeAmenity(a)" /></template>
					</ListRow>
				</div>
				<div v-if="canEdit" class="row wrap" style="margin-top: var(--gap-md)">
					<Input v-model="newAmenity.name" placeholder="Название" style="min-width: 120px" />
					<Select v-model="newAmenity.icon" style="width: auto"><option v-for="i in ICON_OPTIONS" :key="i" :value="i">{{ i }}</option></Select>
					<Select v-model="newAmenity.scope" style="width: auto"><option value="both">везде</option><option value="room">номер</option><option value="hotel">дом</option></Select>
					<Button icon="plus" @click="addAmenity" />
				</div>
			</Card>
		</div>
	</div>
</template>
