export const amenityEmoji = {
	wifi: "📶",
	tv: "📺",
	shower: "🚿",
	fridge: "🧊",
	snow: "❄️",
	utensils: "🍽️",
	washer: "🧺",
	wind: "🌬️",
	dumbbell: "🏋️",
	sofa: "🛋️",
	dot: "•",
}

export const placeEmoji = {
	Питание: "🍽️",
	Магазин: "🛒",
	Медицина: "⚕️",
	default: "📍",
}

export function amenityIcon(name) {
	return amenityEmoji[name] || amenityEmoji.dot
}
