"use client";

import { STORAGE_KEYS } from "../constants";

interface ModelCacheEntry {
	cachedAt: number;
	sizeBytes: number;
	version: string;
}

type ModelCacheMap = Record<string, ModelCacheEntry>;

function getCacheMap(): ModelCacheMap {
	if (typeof window === "undefined") return {};
	try {
		const raw = localStorage.getItem(STORAGE_KEYS.MODEL_CACHE);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function setCacheMap(map: ModelCacheMap): void {
	if (typeof window === "undefined") return;
	localStorage.setItem(STORAGE_KEYS.MODEL_CACHE, JSON.stringify(map));
}

export function isModelCached(modelSlug: string): boolean {
	return modelSlug in getCacheMap();
}

export function getModelCacheInfo(modelSlug: string): ModelCacheEntry | null {
	return getCacheMap()[modelSlug] ?? null;
}

export function setModelCached(
	modelSlug: string,
	sizeBytes: number,
	version: string,
): void {
	const map = getCacheMap();
	map[modelSlug] = { cachedAt: Date.now(), sizeBytes, version };
	setCacheMap(map);
}

export function removeModelFromCache(modelSlug: string): void {
	const map = getCacheMap();
	delete map[modelSlug];
	setCacheMap(map);
}

export function getAllCachedModels(): Array<
	{ slug: string } & ModelCacheEntry
> {
	const map = getCacheMap();
	return Object.entries(map).map(([slug, entry]) => ({ slug, ...entry }));
}
