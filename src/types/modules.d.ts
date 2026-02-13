declare module "kokoro-js" {
	export class KokoroTTS {
		static from_pretrained(
			modelId: string,
			options?: {
				dtype?: string;
				device?: string;
				progress_callback?: (progress: {
					status: string;
					file: string;
					loaded: number;
					total: number;
				}) => void;
			},
		): Promise<KokoroTTS>;

		generate(
			text: string,
			options: { voice: string },
		): Promise<{
			audio: Float32Array;
			sampling_rate: number;
		}>;
	}
}

declare module "@xenova/transformers" {
	export function pipeline(
		task: string,
		model: string,
		options?: {
			device?: string;
			dtype?: Record<string, string>;
			progress_callback?: (progress: {
				status: string;
				file: string;
				loaded: number;
				total: number;
			}) => void;
		},
	): Promise<CallableFunction>;
}
