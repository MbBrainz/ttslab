export const APP_NAME = "VoiceBench";
export const APP_DESCRIPTION =
	"Test TTS & STT models in your browser. No server. No data collection. Powered by WebGPU.";
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://ttslab.dev";

export const LOCAL_STORAGE_PREFIX = "voicebench:";

export const STORAGE_KEYS = {
	TTS_TEXTS: `${LOCAL_STORAGE_PREFIX}tts-texts`,
	TTS_HISTORY: `${LOCAL_STORAGE_PREFIX}tts-history`,
	STT_HISTORY: `${LOCAL_STORAGE_PREFIX}stt-history`,
	PREFERENCES: `${LOCAL_STORAGE_PREFIX}preferences`,
	MODEL_CACHE: `${LOCAL_STORAGE_PREFIX}model-cache`,
	COMPARISON_PINS: `${LOCAL_STORAGE_PREFIX}comparison-pins`,
} as const;

export const AUDIO_CACHE_NAME = "voicebench-audio";

export const MAX_TTS_TEXTS = 50;
export const MAX_TTS_HISTORY = 100;
export const MAX_STT_HISTORY = 100;
