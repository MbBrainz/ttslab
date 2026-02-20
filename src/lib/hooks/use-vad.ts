"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseVadOptions {
	onSpeechStart?: () => void;
	onSpeechEnd?: (audio: Float32Array) => void;
}

export function useVad({ onSpeechStart, onSpeechEnd }: UseVadOptions) {
	const [isListening, setIsListening] = useState(false);
	const [isSpeechActive, setIsSpeechActive] = useState(false);
	// biome-ignore lint/suspicious/noExplicitAny: MicVAD type from @ricky0123/vad-web
	const vadRef = useRef<any>(null);
	const callbacksRef = useRef({ onSpeechStart, onSpeechEnd });

	// Keep callbacks fresh without re-creating VAD
	useEffect(() => {
		callbacksRef.current = { onSpeechStart, onSpeechEnd };
	}, [onSpeechStart, onSpeechEnd]);

	const start = useCallback(async () => {
		if (vadRef.current) return;

		const { MicVAD } = await import("@ricky0123/vad-web");

		const vad = await MicVAD.new({
			baseAssetPath: "/vad/",
			onnxWASMBasePath: "/onnx/",
			positiveSpeechThreshold: 0.8,
			minSpeechMs: 100,
			preSpeechPadMs: 160,
			onSpeechStart: () => {
				setIsSpeechActive(true);
				callbacksRef.current.onSpeechStart?.();
			},
			onSpeechEnd: (audio: Float32Array) => {
				setIsSpeechActive(false);
				callbacksRef.current.onSpeechEnd?.(audio);
			},
		});

		vadRef.current = vad;
		vad.start();
		setIsListening(true);
	}, []);

	const stop = useCallback(() => {
		if (vadRef.current) {
			vadRef.current.pause();
			vadRef.current.destroy();
			vadRef.current = null;
		}
		setIsListening(false);
		setIsSpeechActive(false);
	}, []);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (vadRef.current) {
				vadRef.current.pause();
				vadRef.current.destroy();
				vadRef.current = null;
			}
		};
	}, []);

	return { isListening, isSpeechActive, start, stop };
}
