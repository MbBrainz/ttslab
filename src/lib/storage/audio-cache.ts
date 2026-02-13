"use client";

import { AUDIO_CACHE_NAME } from "../constants";

export async function cacheAudio(
	generationId: string,
	audioBlob: Blob,
): Promise<void> {
	try {
		const cache = await caches.open(AUDIO_CACHE_NAME);
		await cache.put(
			new Request(`/audio/${generationId}`),
			new Response(audioBlob, {
				headers: { "Content-Type": audioBlob.type || "audio/wav" },
			}),
		);
	} catch {
		// Cache API not available or quota exceeded
	}
}

export async function getAudio(generationId: string): Promise<Blob | null> {
	try {
		const cache = await caches.open(AUDIO_CACHE_NAME);
		const response = await cache.match(new Request(`/audio/${generationId}`));
		if (!response) return null;
		return response.blob();
	} catch {
		return null;
	}
}

export async function deleteAudio(generationId: string): Promise<void> {
	try {
		const cache = await caches.open(AUDIO_CACHE_NAME);
		await cache.delete(new Request(`/audio/${generationId}`));
	} catch {
		// ignore
	}
}

export async function clearAllAudio(): Promise<void> {
	try {
		await caches.delete(AUDIO_CACHE_NAME);
	} catch {
		// ignore
	}
}

export async function getAudioCacheSize(): Promise<number> {
	try {
		const cache = await caches.open(AUDIO_CACHE_NAME);
		const keys = await cache.keys();
		let total = 0;
		for (const key of keys) {
			const resp = await cache.match(key);
			if (resp) {
				const blob = await resp.blob();
				total += blob.size;
			}
		}
		return total;
	} catch {
		return 0;
	}
}
