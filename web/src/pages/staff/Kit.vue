<script setup>
import { ref } from "vue"
import { toast } from "@/toast"
import {
	Button, IconButton, Input, Textarea, Select, Field, Switch, Card, PageHeader,
	Chip, Badge, StatusDot, Avatar, EmptyState, Skeleton, ListRow, SegmentedControl,
	Stat, MeterBar, Drawer, Tabs, FilterBar, Popover, DataTable, confirm,
} from "@/ui"
import Icon from "@/components/Icon.vue"

const text = ref("")
const flag = ref(true)
const seg = ref("a")
const tab = ref("one")
const drawer = ref(false)

const rows = [
	{ id: 1, name: "Иванов И. П.", room: "002", status: "Проживает" },
	{ id: 2, name: "Сидоров П. А.", room: "004", status: "Ожидается" },
]
const columns = [
	{ key: "name", label: "ФИО", sortable: true },
	{ key: "room", label: "Номер", sortable: true, align: "center" },
	{ key: "status", label: "Статус" },
]

async function ask() {
	const ok = await confirm({ title: "Удалить запись?", message: "Это действие необратимо.", danger: true, confirmLabel: "Удалить" })
	toast(ok ? "Удалено" : "Отменено", ok ? "success" : "info")
}
</script>

<template>
	<div class="grid" style="max-width: 900px; gap: var(--gap-xl)">
		<PageHeader title="UI-кит" subtitle="Каталог компонентов (dev)" icon="layout" />

		<Card title="Кнопки">
			<div class="row wrap">
				<Button variant="primary">Primary</Button>
				<Button variant="brand" icon="plus">Brand</Button>
				<Button>Default</Button>
				<Button variant="ghost">Ghost</Button>
				<Button variant="danger" icon="trash">Danger</Button>
				<Button :loading="true">Loading</Button>
				<IconButton icon="pencil" label="Правка" />
			</div>
		</Card>

		<Card title="Поля">
			<Field label="Текст" hint="Подсказка под полем"><Input v-model="text" /></Field>
			<Field label="С ошибкой" error="Обязательное поле"><Input :invalid="true" /></Field>
			<Field label="Выбор"><Select><option>Один</option><option>Два</option></Select></Field>
			<Field label="Многострочное"><Textarea v-model="text" :rows="2" /></Field>
			<Switch v-model="flag" label="Переключатель" hint="С подписью и подсказкой" />
		</Card>

		<Card title="Индикаторы">
			<div class="row wrap">
				<Chip>Обычный</Chip>
				<Chip color="var(--color-green)" dot>Проживает</Chip>
				<Chip color="var(--color-orange)" solid>Ремонт</Chip>
				<Badge>3</Badge>
				<Badge variant="danger">9</Badge>
				<StatusDot color="var(--color-blue)" />
				<Avatar name="Иван" />
			</div>
		</Card>

		<Card title="Сегменты и вкладки">
			<SegmentedControl v-model="seg" :options="[{ value: 'a', label: 'Все', count: 12 }, { value: 'b', label: 'Новые', count: 3 }]" />
			<div style="margin-top: var(--gap-md)"><Tabs v-model="tab" :options="[{ value: 'one', label: 'Обзор', icon: 'info' }, { value: 'two', label: 'Номера' }]" /></div>
		</Card>

		<Card title="Статистика">
			<div class="row wrap">
				<Stat :value="'87%'" label="Загрузка" accent />
				<Stat :value="12" label="Заезды" />
			</div>
			<div style="margin-top: var(--gap-md)"><MeterBar :value="72" /></div>
		</Card>

		<div>
			<div class="section-title">Таблица</div>
			<DataTable :columns="columns" :rows="rows">
				<template #cell-status="{ value }"><Chip color="var(--color-green)" dot>{{ value }}</Chip></template>
				<template #actions><IconButton icon="pencil" label="Правка" size="sm" /></template>
			</DataTable>
		</div>

		<Card title="Списки и состояния">
			<ListRow interactive>
				<template #lead><Avatar name="П" /></template>
				<template #title>Пример строки</template>
				<template #sub>Вторичный текст</template>
				<template #trail><Chip color="var(--color-green)" dot>ОК</Chip></template>
			</ListRow>
			<div style="margin-top: var(--gap-md)"><Skeleton variant="row" :count="2" /></div>
			<EmptyState icon="wrench" title="Пусто" text="Здесь пока ничего нет" />
		</Card>

		<Card title="Оверлеи">
			<div class="row wrap">
				<Button @click="drawer = true">Открыть Drawer</Button>
				<Button variant="danger" @click="ask">ConfirmDialog</Button>
				<Button variant="ghost" @click="toast('Успех!', 'success')">Toast success</Button>
				<Button variant="ghost" @click="toast('Ошибка', 'error')">Toast error</Button>
				<Popover trigger="hover">
					<template #trigger><Chip>Наведи</Chip></template>
					Всплывающая подсказка
				</Popover>
			</div>
		</Card>

		<Drawer v-if="drawer" title="Пример Drawer" subtitle="Боковая панель для форм" @close="drawer = false">
			<Field label="Поле в drawer"><Input v-model="text" /></Field>
			<template #foot>
				<Button variant="ghost" @click="drawer = false">Отмена</Button>
				<Button variant="primary" @click="drawer = false">Сохранить</Button>
			</template>
		</Drawer>
	</div>
</template>
