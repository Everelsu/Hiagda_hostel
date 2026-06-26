// Сопоставление названий удобств/мест с именами иконок (Icon.vue)
export const amenityIconMap = {
	wifi: "wifi",
	tv: "tv",
	shower: "droplet",
	fridge: "refrigerator",
	snow: "snowflake",
	utensils: "utensils",
	washer: "washing-machine",
	wind: "wind",
	dumbbell: "dumbbell",
	sofa: "armchair",
	dot: "dot",
}

export const placeIconMap = {
	Питание: "utensils",
	Магазин: "tag",
	Медицина: "plus",
	default: "map-pin",
}

export function amenityIcon(name) {
	return amenityIconMap[name] || "dot"
}
export function placeIcon(kind) {
	return placeIconMap[kind] || placeIconMap.default
}
