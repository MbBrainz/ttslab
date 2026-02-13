"use client";

import {
	MAX_STT_HISTORY,
	MAX_TTS_HISTORY,
	MAX_TTS_TEXTS,
	STORAGE_KEYS,
} from "../constants";

export interface TtsTextItem {
	id: string;
	text: string;
	lastUsed: number;
	useCount: number;
}

export interface TtsHistoryItem {
	id: string;
	modelSlug: string;
	voiceId: string;
	textId: string;
	textPreview: string;
	duration: number;
	generationTime: number;
	backend: "webgpu" | "wasm";
	timestamp: number;
	cacheKey: string;
}

export interface SttHistoryItem {
	id: string;
	modelSlug: string;
	transcript: string;
	audioDuration: number;
	processingTime: number;
	backend: "webgpu" | "wasm";
	timestamp: number;
}

export interface UserPreferences {
	preferredBackend: "webgpu" | "wasm" | "auto";
	autoPlayGenerated: boolean;
	showAdvancedMetrics: boolean;
	defaultTtsText: string | null;
	theme: "system" | "light" | "dark";
}

const DEFAULT_PREFERENCES: UserPreferences = {
	preferredBackend: "auto",
	autoPlayGenerated: true,
	showAdvancedMetrics: false,
	defaultTtsText: null,
	theme: "system",
};

function getItem<T>(key: string, fallback: T): T {
	if (typeof window === "undefined") return fallback;
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : fallback;
	} catch {
		return fallback;
	}
}

function setItem<T>(key: string, value: T): void {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage full — prune and retry
	}
}

// TTS Texts
export function getTtsTexts(): TtsTextItem[] {
	return getItem<TtsTextItem[]>(STORAGE_KEYS.TTS_TEXTS, []);
}

export function addTtsText(id: string, text: string): void {
	const items = getTtsTexts();
	const existing = items.find((i) => i.text === text);
	if (existing) {
		existing.lastUsed = Date.now();
		existing.useCount++;
	} else {
		items.unshift({ id, text, lastUsed: Date.now(), useCount: 1 });
	}
	// Prune oldest
	items.sort((a, b) => b.lastUsed - a.lastUsed);
	setItem(STORAGE_KEYS.TTS_TEXTS, items.slice(0, MAX_TTS_TEXTS));
}

// TTS History
export function getTtsHistory(modelSlug?: string): TtsHistoryItem[] {
	const items = getItem<TtsHistoryItem[]>(STORAGE_KEYS.TTS_HISTORY, []);
	if (modelSlug) return items.filter((i) => i.modelSlug === modelSlug);
	return items;
}

export function addTtsHistoryItem(item: TtsHistoryItem): void {
	const items = getTtsHistory();
	items.unshift(item);
	setItem(STORAGE_KEYS.TTS_HISTORY, items.slice(0, MAX_TTS_HISTORY));
}

// STT History
export function getSttHistory(modelSlug?: string): SttHistoryItem[] {
	const items = getItem<SttHistoryItem[]>(STORAGE_KEYS.STT_HISTORY, []);
	if (modelSlug) return items.filter((i) => i.modelSlug === modelSlug);
	return items;
}

export function addSttHistoryItem(item: SttHistoryItem): void {
	const items = getSttHistory();
	items.unshift(item);
	setItem(STORAGE_KEYS.STT_HISTORY, items.slice(0, MAX_STT_HISTORY));
}

// Preferences
export function getPreferences(): UserPreferences {
	return getItem<UserPreferences>(
		STORAGE_KEYS.PREFERENCES,
		DEFAULT_PREFERENCES,
	);
}

export function setPreferences(prefs: Partial<UserPreferences>): void {
	const current = getPreferences();
	setItem(STORAGE_KEYS.PREFERENCES, { ...current, ...prefs });
}

// Upvote tracking (client-side)
export function hasUpvoted(modelSlug: string): boolean {
	const voted = getItem<string[]>("voicebench:upvoted", []);
	return voted.includes(modelSlug);
}

export function markUpvoted(modelSlug: string): void {
	const voted = getItem<string[]>("voicebench:upvoted", []);
	if (!voted.includes(modelSlug)) {
		voted.push(modelSlug);
		setItem("voicebench:upvoted", voted);
	}
}
