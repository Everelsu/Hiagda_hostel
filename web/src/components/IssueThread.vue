<script setup>
/**
 * Переписка по заявке. Кладётся последним в тело Drawer: сообщения листаются вместе с ним,
 * поле ввода закреплено внизу. При открытии и новых сообщениях — прокрутка к последнему;
 * если человек читает выше, вместо прыжка появляется кнопка «новые сообщения».
 */
import { dateTime } from "@/utils/date"
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue"
import { api, post, uploadFile } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import Icon from "@/components/Icon.vue"
import PhotoView from "@/components/PhotoView.vue"
import { onRealtime } from "@/realtime"

const props = defineProps({
	issueId: { type: [Number, String], required: true },
	title: { type: String, default: "Переписка" },
	// Починенная заявка: переписку можно читать, но не писать
	closed: { type: Boolean, default: false },
	closedHint: { type: String, default: "Заявка закрыта — переписка только для чтения" },
})
const auth = useAuthStore()
const comments = ref([])
const text = ref("")
const busy = ref(false)
const root = ref(null)
const input = ref(null)
const unseen = ref(0)
// Появление анимируем только у новых сообщений, не у всей истории при открытии
const animate = ref(false)

const scroller = () => root.value?.closest(".k-drawer__body") || document.scrollingElement
const nearBottom = () => {
	const s = scroller()
	return !s || s.scrollHeight - s.scrollTop - s.clientHeight < 120
}
function toBottom(smooth = true) {
	const s = scroller()
	s?.scrollTo({ top: s.scrollHeight, behavior: smooth ? "smooth" : "auto" })
	unseen.value = 0
}
const onScroll = () => nearBottom() && (unseen.value = 0)

async function load(first = false) {
	const follow = first || nearBottom()
	const before = comments.value.length
	try {
		comments.value = await api(`/issues/${props.issueId}/comments`)
	} catch (e) {
		return toast.error(e.message)
	}
	await nextTick()
	animate.value = true
	if (follow) toBottom(!first)
	else if (comments.value.length > before) unseen.value += comments.value.length - before
}
onMounted(async () => {
	await load(true)
	scroller()?.addEventListener("scroll", onScroll, { passive: true })
})
watch(
	() => props.issueId,
	() => {
		animate.value = false
		load(true)
	},
)
const stopRealtime = onRealtime((event) => {
	if ((event.type === "issue:comment" || event.type === "issues:changed") && Number(event.issueId) === Number(props.issueId)) load()
})
onUnmounted(() => {
	stopRealtime()
	scroller()?.removeEventListener("scroll", onScroll)
})

// Поле растёт вместе с текстом (до ~6 строк); Enter — отправить, Shift+Enter — новая строка
function grow() {
	const el = input.value
	if (!el) return
	el.style.height = "auto"
	el.style.height = Math.min(el.scrollHeight, 150) + "px"
}
function onKey(e) {
	if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
		e.preventDefault()
		send()
	}
}
// Фото к сообщению: загружаем сразу, отправляется вместе с текстом (или без него)
const photo = ref("")
const uploading = ref(false)
async function onFile(e) {
	const file = e.target.files?.[0]
	e.target.value = ""
	if (!file) return
	uploading.value = true
	try {
		photo.value = await uploadFile(file)
	} catch (err) {
		toast.error(err.message)
	} finally {
		uploading.value = false
	}
}

async function send() {
	const t = text.value.trim()
	if ((!t && !photo.value) || busy.value || uploading.value) return
	busy.value = true
	try {
		await post(`/issues/${props.issueId}/comments`, { text: t, photo: photo.value || null })
		text.value = ""
		photo.value = ""
		await nextTick()
		grow()
		await load(true)
		toBottom()
	} catch (e) {
		toast.error(e.message)
	} finally {
		busy.value = false
		input.value?.focus()
	}
}
const mine = (c) => c.user_id === auth.user?.id
// Сегодня — только время, иначе коротко дата и время
const today = new Date().toDateString()
const fmt = (d) =>
	new Date(String(d).replace(" ", "T") + "Z").toDateString() === today
		? dateTime(d, { hour: "2-digit", minute: "2-digit" })
		: dateTime(d, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
</script>

<template>
	<section ref="root" class="chat">
		<div class="chat__title">{{ title }}</div>
		<div v-if="!comments.length" class="chat__empty">
			<Icon name="message-square" size="1.4rem" />
			Сообщений пока нет. Напишите первое — комендант ответит здесь.
		</div>
		<TransitionGroup tag="div" :name="animate ? 'msg' : 'none'" class="chat__list">
			<div v-for="c in comments" :key="c.id" class="msg" :class="{ mine: mine(c), staff: c.author_staff && !mine(c) }">
				<div class="msg__head">
					<b>{{ mine(c) ? "Вы" : c.author || "Пользователь" }}</b>
					<span v-if="c.author_staff && !mine(c)" class="msg__tag">персонал</span>
					<span class="msg__time">{{ fmt(c.created_at) }}</span>
				</div>
				<PhotoView v-if="c.photo" :src="c.photo" alt="Фото в переписке" class="msg__photo" />
				<div v-if="c.text" class="msg__text">{{ c.text }}</div>
			</div>
		</TransitionGroup>

		<div v-if="closed" class="composer composer--closed"><Icon name="lock" size="1rem" /> {{ closedHint }}</div>
		<div v-else class="composer">
			<Transition name="pill">
				<button v-if="unseen" type="button" class="composer__new" @click="toBottom()">
					<Icon name="arrow-down" size="0.9rem" /> Новые сообщения · {{ unseen }}
				</button>
			</Transition>
			<div v-if="photo || uploading" class="composer__att">
				<img v-if="photo" :src="photo" alt="" />
				<span v-else class="composer__att-wait"><Icon name="rotate-cw" size="1rem" /></span>
				<button v-if="photo" type="button" aria-label="Убрать фото" @click="photo = ''"><Icon name="x" size="0.8rem" /></button>
			</div>
			<label class="composer__clip" :class="{ busy: uploading }" title="Прикрепить фото">
				<input type="file" accept="image/*" hidden @change="onFile" />
				<Icon name="camera" size="1.15rem" />
			</label>
			<textarea
				ref="input"
				v-model="text"
				rows="1"
				enterkeyhint="send"
				placeholder="Написать сообщение…"
				@input="grow"
				@keydown="onKey"
			/>
			<button type="button" class="composer__send" :disabled="busy || uploading || (!text.trim() && !photo)" aria-label="Отправить" @click="send">
				<Icon name="send" size="1.1rem" />
			</button>
		</div>
	</section>
</template>

<style scoped>
/* Растягивается до низа Drawer: при коротком разговоре поле ввода всё равно внизу */
.chat {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: var(--gap-sm);
	min-height: 12rem;
}
.chat__title {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.chat__empty {
	display: grid;
	justify-items: center;
	gap: 6px;
	padding: var(--gap-lg) var(--gap-md);
	border: 1px dashed var(--color-divider);
	border-radius: var(--radius-lg);
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
	text-align: center;
}
.chat__list {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.msg {
	align-self: flex-start;
	max-width: 85%;
	padding: 8px 12px;
	border-radius: 14px 14px 14px 4px;
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	font-size: var(--font-size-sm);
}
.msg.staff {
	background: var(--color-brand-highlight);
	border-color: color-mix(in srgb, var(--color-brand) 30%, transparent);
}
.msg.mine {
	align-self: flex-end;
	border-radius: 14px 14px 4px 14px;
	background: var(--color-brand);
	border-color: transparent;
	color: var(--color-accent-contrast);
}
.msg__head {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 6px;
	margin-bottom: 2px;
	font-size: var(--font-size-xs);
}
.msg__head b {
	color: var(--color-contrast);
}
.msg.mine .msg__head b,
.msg.mine .msg__time {
	color: inherit;
	opacity: 0.8;
}
.msg__time {
	margin-left: auto;
	padding-left: var(--gap-sm);
	color: var(--color-secondary);
	white-space: nowrap;
}
.msg__tag {
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	color: var(--color-brand);
	border: 1px solid var(--color-brand);
	border-radius: var(--radius-max);
	padding: 0 6px;
}
.msg__text {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
.msg .msg__photo {
	margin: 4px 0;
	height: 120px;
	max-width: 220px;
}
.msg-enter-active {
	transition: opacity 220ms ease, transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.msg-enter-from {
	opacity: 0;
	transform: translateY(8px);
}

/* Поле ввода прилипает к низу Drawer и занимает его всю ширину */
.composer {
	position: sticky;
	bottom: calc(-1 * var(--gap-xl));
	z-index: 2;
	display: flex;
	align-items: flex-end;
	gap: var(--gap-sm);
	margin: var(--gap-sm) calc(-1 * var(--gap-xl)) calc(-1 * var(--gap-xl));
	padding: var(--gap-md) var(--gap-xl) calc(var(--gap-md) + env(safe-area-inset-bottom));
	background: var(--color-raised-bg);
	border-top: 1px solid var(--color-divider);
}
.composer--closed {
	align-items: center;
	justify-content: center;
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
}
.composer__clip {
	display: grid;
	place-items: center;
	width: 2.6rem;
	height: 2.6rem;
	flex-shrink: 0;
	border-radius: 50%;
	color: var(--color-secondary);
	cursor: pointer;
	transition: background var(--speed-fast), color var(--speed-fast);
}
.composer__clip:hover {
	background: var(--color-button-bg);
	color: var(--color-brand);
}
.composer__clip.busy {
	pointer-events: none;
	opacity: 0.5;
}
.composer__att {
	position: absolute;
	left: var(--gap-xl);
	bottom: calc(100% + 8px);
	width: 64px;
	height: 64px;
	border-radius: var(--radius-md);
	overflow: hidden;
	border: 2px solid var(--color-brand);
	background: var(--color-bg);
	box-shadow: var(--shadow-floating);
}
.composer__att img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}
.composer__att-wait {
	display: grid;
	place-items: center;
	height: 100%;
	color: var(--color-brand);
}
.composer__att button {
	position: absolute;
	top: 2px;
	right: 2px;
	display: grid;
	place-items: center;
	width: 1.3rem;
	height: 1.3rem;
	border: none;
	border-radius: 50%;
	background: rgba(0, 0, 0, 0.65);
	color: #fff;
	cursor: pointer;
}
.composer textarea {
	flex: 1;
	min-height: 2.6rem;
	max-height: 150px;
	padding: 10px 14px;
	resize: none;
	border-radius: 20px;
	border: 1px solid var(--color-button-border);
	background: var(--color-bg);
	color: var(--color-contrast);
	font: inherit;
	font-size: var(--font-size-sm);
	line-height: 1.4;
}
.composer textarea:focus {
	outline: none;
	border-color: var(--color-brand);
}
.composer__send {
	display: grid;
	place-items: center;
	width: 2.6rem;
	height: 2.6rem;
	flex-shrink: 0;
	border: none;
	border-radius: 50%;
	background: var(--color-brand);
	color: var(--color-accent-contrast);
	cursor: pointer;
	transition: transform var(--speed-fast), opacity var(--speed-fast);
}
.composer__send:disabled {
	opacity: 0.4;
	cursor: default;
}
.composer__send:not(:disabled):active {
	transform: scale(0.9);
}
.composer__new {
	position: absolute;
	left: 50%;
	bottom: calc(100% + 8px);
	transform: translateX(-50%);
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 6px 12px;
	border: none;
	border-radius: 999px;
	background: var(--color-brand);
	color: var(--color-accent-contrast);
	font: inherit;
	font-size: var(--font-size-xs);
	font-weight: var(--font-weight-bold);
	box-shadow: var(--shadow-floating);
	cursor: pointer;
}
.pill-enter-active,
.pill-leave-active {
	transition: opacity 180ms ease, transform 180ms ease;
}
.pill-enter-from,
.pill-leave-to {
	opacity: 0;
	transform: translate(-50%, 6px);
}
</style>
