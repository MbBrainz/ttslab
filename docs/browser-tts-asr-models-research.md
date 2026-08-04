# Browser-Ready TTS/ASR Models: Technical Research

Comprehensive technical specifications for integrating short-term models into voicebench (TTSLab) browser environment.

---

## 1. Whisper Large V3 Turbo (ASR)

### Model ID & Source
- **HuggingFace ID**: `onnx-community/whisper-large-v3-turbo`
- **Base Model**: `openai/whisper-large-v3-turbo` (OpenAI)
- **Format**: ONNX-converted for web compatibility
- **Task**: Automatic Speech Recognition (ASR)

### Pipeline Compatibility
✅ **Yes, uses standard transformers.js pipeline**
- Pipeline type: `automatic-speech-recognition`
- Compatible with Transformers.js for direct browser integration
- 10+ active Spaces using this model for web deployment

### Quantization & Dtype Options
- **22 quantized variants** available
- **Recommended for WebGPU**: `dtype: {encoder_model: "fp32", decoder_model_merged: "q4"}`
  - Encoder: FP32 (full precision)
  - Decoder: Q4 quantization
- **Avoid Q8 decoder** on WebGPU (known issue - produces gibberish)

### File Structure
```
onnx/
├── encoder_model.onnx
├── encoder_model.onnx.data
├── decoder_model.onnx
├── decoder_model.onnx.data
├── decoder_with_past_model.onnx
└── decoder_with_past_model.onnx.data
```

### Download Size
- **Encoder (FP32)**: ~745 MB
- **Decoder (Q4)**: ~300-400 MB (estimate)
- **Total (with quantization)**: ~1.0-1.2 GB
- Reference: Standard Large V3 ONNX ~1.5-2.0 GB

### Known Issues
⚠️ **Critical WebGPU Bug**: Q8 decoder quantization produces gibberish output on WebGPU despite correct output on WASM
- Issue: https://github.com/huggingface/transformers.js/issues/1317
- Workaround: Use FP32 encoder + Q4 decoder instead
- Memory leak: WebGPU doesn't dispose tensors; memory grows until OOM on repeated transcriptions
- Mitigation: Manual tensor cleanup required

### Browser Integration Complexity
**Low-Medium**: Standard transformers.js pipeline, but requires careful quantization configuration
- Loading time: ~2-5 seconds (depends on quantization)
- Inference time: ~2-10 seconds per audio chunk (depends on length)
- RTF (Real-Time Factor): ~0.5-0.8x

### Voices
N/A (ASR model, not TTS)

### Recommended Implementation Pattern
```javascript
import { pipeline } from "@xenova/transformers";

const transcriber = await pipeline(
  "automatic-speech-recognition",
  "onnx-community/whisper-large-v3-turbo",
  {
    quantized: true,
    dtype: {
      encoder_model: "fp32",
      decoder_model_merged: "q4"
    },
    device: "webgpu" // Use wasm if WebGPU unavailable
  }
);
```

---

## 2. Chatterbox Turbo ONNX (TTS)

### Model ID & Source
- **Primary HuggingFace ID**: `ResembleAI/chatterbox-turbo-ONNX`
- **Alternative**: `onnx-community/chatterbox-ONNX` (non-turbo)
- **Organization**: Resemble AI
- **License**: MIT
- **Language**: English

### Pipeline Compatibility
✅ **Partially supported in transformers.js v4**
- Not a standard transformers.js pipeline task (TTS isn't native)
- Custom integration required using ONNX Runtime Web directly
- Added to Transformers.js v4 models but needs custom wrapper
- Status: Open feature request for full transformers.js support

### Model Architecture
- **Backbone**: 350M parameter Llama-based language model
- **Training Data**: 0.5M hours of cleaned audio
- **Sample Rate**: 24,000 Hz
- **Inference Steps**: Single-step mel decoder (optimized from 10 steps)

### ONNX Components
```
onnx/
├── speech_encoder.onnx + .onnx_data
├── embed_tokens.onnx + .onnx_data
├── conditional_decoder.onnx + .onnx_data
├── language_model.onnx + .onnx_data (2GB FP32)
├── language_model_q4.onnx (350MB - quantized)
└── default_voice.wav (reference voice)
```

### Download Size
- **Total Repository**: 7.39 GB
- **Language Model (FP32)**: 2.0 GB
- **Language Model (Q4 quantized)**: 350 MB
- **Speech Encoder + Decoders**: ~1.5 GB
- **Config files & tokenizer**: 3.56 MB

### Voices & Voice Cloning
✅ **Zero-shot voice cloning supported**
- Requires reference audio (WAV format, 24kHz)
- Reference length: 5-10 seconds optimal
- Can synthesize unlimited unique voices from any audio sample
- Pre-included default voice in repository

### Special Features
- Paralinguistic tags: `[cough]`, `[laugh]`, `[chuckle]` natively supported
- Emotion exaggeration control (0-1+ range)
- Classifier-free guidance (CFG) parameter
- Built-in Perth watermarking (imperceptible, survives MP3/editing)
- Alignment-informed inference (ultra-stable)

### Browser Integration Complexity
**Medium-High**: Custom ONNX Runtime integration, voice cloning adds complexity
- No standard transformers.js task
- Requires direct ONNX Runtime Web with WebGPU/WASM
- Speaker embedding extraction adds preprocessing step
- Voice cloning requires audio processing pipeline

### Quantization Options
- **FP32**: Full precision (slower, larger)
- **Q4**: Quantized (fast, 350MB vs 2GB)
- Recommended for browser: Q4 language model + FP32 encoder

### Recommended Implementation Pattern
```javascript
import { InferenceSession } from "onnxruntime-web";
import { AutoTokenizer } from "@xenova/transformers";

// Load models
const speechEncoder = await InferenceSession.create(
  "path/to/speech_encoder.onnx",
  { executionProviders: ["webgpu", "wasm"] }
);
const decoder = await InferenceSession.create(
  "path/to/conditional_decoder.onnx",
  { executionProviders: ["webgpu", "wasm"] }
);
const languageModel = await InferenceSession.create(
  "path/to/language_model_q4.onnx", // Use quantized
  { executionProviders: ["webgpu", "wasm"] }
);

// Voice cloning requires:
// 1. Load reference audio
// 2. Extract speaker embeddings via speech_encoder
// 3. Pass embeddings + tokenized text to language_model
// 4. Generate mel-spectrograms via conditional_decoder
// 5. Vocoder to audio (not included - need separate vocoder)
```

### Known Issues
- No vocoder included in ONNX export (need HiFi-GAN or similar for audio synthesis)
- Large model size requires careful chunking for browser download
- Voice cloning quality depends on reference audio quality

---

## 3. F5-TTS ONNX (TTS with Voice Cloning)

### Model ID & Source
- **HuggingFace ID**: `huggingfacess/F5-TTS-ONNX`
- **GitHub Implementation**: https://github.com/nsarang/voice-cloning-f5-tts (browser demo)
- **Official F5-TTS**: https://github.com/SWivid/F5-TTS

### Pipeline Compatibility
❌ **No transformers.js support**
- Requires direct ONNX Runtime Web
- Custom inference pipeline required
- Community browser demo uses custom architecture

### ONNX Components (3-Stage Pipeline)
```
model/F5-TTS-ONNX/
├── F5_Preprocess.ort (CPU) / .onnx (GPU)
├── F5_Transformer.ort (CPU) / .onnx (GPU)
└── F5_Decode.ort (CPU) / .onnx (GPU)
```

### Model Architecture Details
- **Transformer Component**: 1,281 ONNX nodes
- **Inference Method**: Neural Flow Matching (configurable NFE steps)
- **Optimization**: Reduced transpose() and unsqueeze() operators for browser efficiency
- **Precision**: FP16 for GPU acceleration (200MB FP16 vs larger FP32)

### Download Size
- **F5_Transformer.onnx (FP16)**: ~200 MB
- **F5_Preprocess.onnx**: ~50-100 MB (estimate)
- **F5_Decode.onnx**: ~50-100 MB (estimate)
- **Total**: ~300-400 MB

### Voices & Voice Cloning
✅ **Zero-shot voice cloning with reference audio**
- Reference audio: 5-10 seconds optimal
- Supports multi-speaker generation
- Fully client-side in browser demo

### Browser Integration Complexity
**High**: Custom multi-stage pipeline with Web Workers
- Requires ONNX Runtime Web + WebGPU/WASM
- Three-stage inference (Preprocess → Transformer → Decode)
- Web Worker threading required for UI responsiveness
- Custom tensor serialization via Comlink

### Quantization Options
- **FP16**: GPU acceleration (recommended for browser)
- **FP32**: Full precision (slower, larger)
- I/O Binding optimization available via ONNX Runtime

### Browser Implementation Details
```
Architecture:
├── Encoder Stage
│   ├── Load reference audio (5-10s)
│   ├── Extract speaker embeddings
│   └── Generate latent representations (RoPE embeddings)
├── Transformer Stage
│   ├── Iterative denoising (NFE steps configurable)
│   └── Generate mel-spectrogram latents
├── Decoder Stage
│   ├── Convert latents to mel-spectrograms
│   └── Vocoder to waveform
└── Threading
    └── All inference in Web Workers (Comlink serialization)
```

### Supporting Components
- Distil Whisper Small.en for transcription
- Custom audio normalization & silence detection
- Event-driven progress reporting
- Model caching for repeated use

### Known Issues
- Complex multi-stage pipeline (high implementation effort)
- Memory management in Web Workers important
- Vocoder still needed for final audio synthesis
- Requires careful tensor lifecycle management

### Recommended Implementation Pattern
```javascript
// Three parallel ONNX Runtime sessions
const preprocess = await InferenceSession.create("F5_Preprocess.onnx");
const transformer = await InferenceSession.create("F5_Transformer.onnx");
const decode = await InferenceSession.create("F5_Decode.onnx");

// Pipeline in Web Worker:
// 1. Load reference audio + normalize
// 2. Preprocess: reference_audio → speaker_embeddings
// 3. Encode: text → token_ids
// 4. Transformer: (embeddings, tokens, nfe_steps) → mel_latents
// 5. Decode: mel_latents → mel_spectrogram
// 6. Vocoder: mel_spectrogram → waveform
```

---

## 4. Moonshine Language Variants (ASR)

### Model IDs & Source
- **Base ID Pattern**: `onnx-community/moonshine-{size}-{language}-ONNX`
- **Size Options**: `tiny` (34M params), `base` (optional)
- **Organization**: Moonshine AI
- **Framework**: ONNX (via OnnxRuntime)

### Supported Languages & ONNX Variants

| Language | Tiny | Base | IETF Code |
|----------|------|------|-----------|
| English | ✅ `moonshine-tiny-ONNX` | ✅ | `en` |
| Japanese | ✅ | ✅ `moonshine-base-ja-ONNX` | `ja` |
| Chinese (Mandarin) | ✅ `moonshine-tiny-zh-ONNX` | ✅ | `zh` |
| Korean | ✅ `moonshine-tiny-ko-ONNX` | ✅ | `ko` |
| Vietnamese | ✅ `moonshine-tiny-vi-ONNX` | | `vi` |
| Arabic | ✅ `moonshine-tiny-ar-ONNX` | | `ar` |
| Spanish | ✅ | | `es` |
| Ukrainian | ✅ | | `uk` |

**Total: 8 languages supported (3 in both Tiny & Base)**

### Pipeline Compatibility
✅ **Yes, uses standard transformers.js pipeline**
- Pipeline type: `automatic-speech-recognition`
- Compatible with Transformers.js
- Language-specific (not multilingual) for higher accuracy
- CER/WER metrics: Non-English use Character Error Rate (CER), English uses WER

### Model Size & Performance
- **Tiny**: 34M parameters (small, fast)
- **Base**: 123M parameters (better accuracy, slower)
- **Medium**: 245M parameters (highest accuracy)
- Each model is monolingual for optimal accuracy

### Download Size
- **Tiny variants**: ~30-50 MB per language
- **Base variants**: ~100-150 MB per language
- Total for all Tiny: ~240-400 MB

### Quantization Options
- ONNX format supports standard int8/int4 quantization
- Model zoo available through huggingface_hub
- Optimized for edge devices

### Browser Integration Complexity
**Low-Medium**: Standard transformers.js ASR pipeline
- Same complexity as Whisper integration
- Language-specific loading (no language auto-detection)
- Inference time: ~1-3 seconds per audio chunk

### Recommended Implementation Pattern
```javascript
import { pipeline } from "@xenova/transformers";

// Load language-specific model
const transcriber = await pipeline(
  "automatic-speech-recognition",
  "onnx-community/moonshine-tiny-en-ONNX", // English
  { device: "webgpu" }
);

// For other languages, just change the model ID:
// "onnx-community/moonshine-tiny-ja-ONNX" (Japanese)
// "onnx-community/moonshine-tiny-zh-ONNX" (Chinese)
// "onnx-community/moonshine-tiny-ko-ONNX" (Korean)
// etc.

const result = await transcriber(audioBuffer);
```

### Key Advantage
Language-specific models provide higher accuracy than multilingual models at similar parameter count. Perfect for single-language applications or UI-based language selection.

### Known Issues
- No multilingual support (must load language-specific model)
- Requires pre-knowledge of audio language for correct model selection

---

## Integration Comparison Matrix

| Feature | Whisper V3 Turbo | Chatterbox Turbo | F5-TTS | Moonshine |
|---------|------------------|------------------|--------|-----------|
| **Task** | ASR | TTS | TTS | ASR |
| **HF Model ID** | `onnx-community/whisper-large-v3-turbo` | `ResembleAI/chatterbox-turbo-ONNX` | `huggingfacess/F5-TTS-ONNX` | `onnx-community/moonshine-tiny-{lang}-ONNX` |
| **Pipeline Type** | `automatic-speech-recognition` | Custom ONNX | Custom ONNX | `automatic-speech-recognition` |
| **Transformers.js Support** | ✅ Native | ✅ v4 (custom wrapper) | ❌ None | ✅ Native |
| **Download Size** | ~1.0-1.2 GB | 7.39 GB | ~300-400 MB | ~30-50 MB/lang |
| **Voices** | N/A | ∞ (zero-shot cloning) | ∞ (zero-shot cloning) | N/A |
| **Reference Audio Required** | N/A | ✅ Yes (5-10s) | ✅ Yes (5-10s) | N/A |
| **WebGPU Support** | ✅ (FP32 encoder) | ✅ | ✅ (FP16) | ✅ |
| **Integration Complexity** | Low-Medium | Medium-High | High | Low-Medium |
| **Known Issues** | Q8 WebGPU bug | Large model size | Complex pipeline | Language selection |
| **RTF (Real-Time Factor)** | ~0.5-0.8x | ~0.5x | ~0.3-0.5x | ~0.7-0.9x |
| **Inference Time** | 2-10s/chunk | 5-15s/chunk | 10-30s/text | 1-3s/chunk |

---

## Browser Deployment Recommendations

### For Transcription (ASR)
1. **Primary**: Whisper Large V3 Turbo (best quality)
   - Use FP32 encoder + Q4 decoder to avoid WebGPU bugs
2. **Alternative**: Moonshine Tiny for faster inference or specific languages
   - 10-100x smaller than Whisper
   - Perfect for real-time speech capture

### For Text-to-Speech (TTS)
1. **Best Overall**: F5-TTS
   - Highest quality, lowest latency
   - Complex but comprehensive browser demo available
2. **Alternative**: Chatterbox Turbo
   - More established, simpler architecture
   - Larger model size
   - Built-in paralinguistic support

### Recommended Stack
```
TTSLab (VoiceBench) Next.js Architecture
├── ASR: Whisper Large V3 Turbo (WebGPU)
├── TTS: F5-TTS (WebGPU with Web Workers)
└── Optional: Moonshine Tiny for fast transcription fallback
```

---

## Technical References

- [Whisper Large V3 Turbo ONNX - HuggingFace](https://huggingface.co/onnx-community/whisper-large-v3-turbo)
- [Chatterbox Turbo ONNX - HuggingFace](https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX)
- [F5-TTS ONNX - HuggingFace](https://huggingface.co/huggingfacess/F5-TTS-ONNX)
- [Voice Cloning F5-TTS Browser Demo](https://github.com/nsarang/voice-cloning-f5-tts)
- [Moonshine ASR Models](https://github.com/moonshine-ai/moonshine)
- [Transformers.js Known Issues](https://github.com/huggingface/transformers.js/issues/1317)
- [ONNX Runtime WebGPU Documentation](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
