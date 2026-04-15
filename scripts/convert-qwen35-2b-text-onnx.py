"""
Convert Qwen3.5-2B VL model → text-only ONNX for transformers.js

Steps:
  1. Extract text backbone via Qwen3_5ForCausalLM (drops vision encoder)
  2. Export to ONNX via torch.onnx.export with merged KV-cache decoder
  3. Optimize with onnxslim
  4. Quantize to q4 (WASM) and q4f16 (WebGPU)
  5. Patch config.json for transformers.js compatibility

Setup:
  uv venv .venv-convert --python 3.13
  source .venv-convert/bin/activate
  uv pip install "transformers>=5.3" torch onnx "onnxruntime>=1.19" \
    onnxconverter-common onnxslim requests huggingface-hub optimum onnx-ir

Run:
  python scripts/convert-qwen35-2b-text-onnx.py
"""

import json
import shutil
import sys
from pathlib import Path

import torch

MODEL_ID = "Qwen/Qwen3.5-2B"
TEXT_CHECKPOINT_DIR = Path("./tmp/qwen3.5-2b-text-only")
ONNX_OUTPUT_DIR = Path("./tmp/qwen3.5-2b-text-onnx")
ONNX_SUBDIR = ONNX_OUTPUT_DIR / "onnx"


def step1_extract_text_backbone():
    """Load VL model with CausalLM class — auto-drops vision weights."""
    from transformers import AutoTokenizer, Qwen3_5ForCausalLM

    if (TEXT_CHECKPOINT_DIR / "config.json").exists():
        with open(TEXT_CHECKPOINT_DIR / "config.json") as f:
            config = json.load(f)
        if config.get("model_type") == "qwen3_5_text":
            print("\n=== Step 1: Text backbone already extracted, skipping ===")
            return

    print(f"\n=== Step 1: Extracting text backbone from {MODEL_ID} ===")

    model = Qwen3_5ForCausalLM.from_pretrained(
        MODEL_ID,
        torch_dtype="auto",
        trust_remote_code=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)

    TEXT_CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(TEXT_CHECKPOINT_DIR)
    tokenizer.save_pretrained(TEXT_CHECKPOINT_DIR)

    with open(TEXT_CHECKPOINT_DIR / "config.json") as f:
        config = json.load(f)
    print(f"  model_type: {config.get('model_type')}")
    print(f"  architectures: {config.get('architectures')}")
    assert config["model_type"] == "qwen3_5_text", "Expected qwen3_5_text model_type"
    print("  OK Text backbone extracted")


def step2_export_onnx():
    """Export to ONNX using transformers' built-in ONNX export."""
    print("\n=== Step 2: Exporting to ONNX ===")

    from transformers import AutoTokenizer, Qwen3_5ForCausalLM, AutoConfig

    ONNX_SUBDIR.mkdir(parents=True, exist_ok=True)

    print("  Loading model for export...")
    config = AutoConfig.from_pretrained(TEXT_CHECKPOINT_DIR, trust_remote_code=True)
    model = Qwen3_5ForCausalLM.from_pretrained(
        TEXT_CHECKPOINT_DIR,
        torch_dtype=torch.float32,
        trust_remote_code=True,
    )
    model.eval()

    tokenizer = AutoTokenizer.from_pretrained(TEXT_CHECKPOINT_DIR, trust_remote_code=True)

    # Create dummy inputs
    batch_size = 1
    seq_len = 4
    dummy_input_ids = torch.randint(0, config.vocab_size, (batch_size, seq_len))
    dummy_attention_mask = torch.ones(batch_size, seq_len, dtype=torch.long)
    dummy_position_ids = torch.arange(seq_len).unsqueeze(0)

    print("  Running torch.onnx.export with JIT tracer (this may take a while)...")

    output_path = ONNX_SUBDIR / "model.onnx"

    # Dynamic axes for variable sequence length and batch
    dynamic_axes = {
        "input_ids": {0: "batch_size", 1: "sequence_length"},
        "attention_mask": {0: "batch_size", 1: "sequence_length"},
        "position_ids": {0: "batch_size", 1: "sequence_length"},
        "logits": {0: "batch_size", 1: "sequence_length"},
    }

    input_names = ["input_ids", "attention_mask", "position_ids"]
    output_names = ["logits"]

    # Use legacy JIT tracer — the dynamo exporter fails on Qwen3.5's
    # data-dependent control flow in _update_linear_attn_mask
    import os
    os.environ["TORCH_ONNX_USE_EXPERIMENTAL_LOGIC"] = "0"

    with torch.no_grad():
        torch.onnx.export(
            model,
            (dummy_input_ids, dummy_attention_mask, dummy_position_ids),
            str(output_path),
            input_names=input_names,
            output_names=output_names,
            dynamic_axes=dynamic_axes,
            opset_version=17,
            do_constant_folding=True,
            external_data=True,
            dynamo=False,
        )

    print(f"  Exported to {output_path}")

    # Optimize with onnxslim
    print("  Optimizing with onnxslim...")
    import subprocess
    result = subprocess.run(
        [sys.executable, "-m", "onnxslim", str(output_path), str(output_path)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  Warning: onnxslim failed: {result.stderr[:300]}")
    else:
        print("  OK Optimized")

    # Copy tokenizer and config files
    for fname in ["config.json", "tokenizer.json", "tokenizer_config.json",
                  "special_tokens_map.json", "vocab.json", "merges.txt",
                  "generation_config.json"]:
        src = TEXT_CHECKPOINT_DIR / fname
        if src.exists():
            shutil.copy(src, ONNX_OUTPUT_DIR / fname)

    print("  OK ONNX export complete")


def step3_quantize():
    """Quantize to q4 and q4f16."""
    print("\n=== Step 3: Quantizing ===")

    import onnx
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

    model_path = ONNX_SUBDIR / "model.onnx"
    print(f"  Source model: {model_path}")

    # Q4 quantization (WASM-compatible)
    print("  Quantizing to Q4 (4-bit integer, block_size=32)...")
    model = onnx.load(str(model_path))
    quantizer = MatMulNBitsQuantizer(
        model,
        block_size=32,
        is_symmetric=True,
        accuracy_level=4,
        n_bits=4,
    )
    quantizer.process()

    q4_path = ONNX_SUBDIR / "model_q4.onnx"
    quantizer.model.save_model_to_file(
        str(q4_path),
        use_external_data_format=True,
    )
    print(f"  OK Q4 saved to {q4_path}")

    # Q4F16 quantization (WebGPU-optimized)
    print("  Quantizing to Q4F16 (4-bit weights + fp16 activations)...")
    from onnxconverter_common import float16

    q4_model = onnx.load(str(q4_path))
    q4f16_model = float16.convert_float_to_float16(
        q4_model,
        keep_io_types=True,
        disable_shape_infer=True,
    )

    q4f16_path = ONNX_SUBDIR / "model_q4f16.onnx"
    onnx.save(
        q4f16_model,
        str(q4f16_path),
        convert_attribute=False,
        all_tensors_to_one_file=True,
    )
    print(f"  OK Q4F16 saved to {q4f16_path}")


def step4_patch_config():
    """Add transformers.js config to config.json."""
    print("\n=== Step 4: Patching config.json ===")

    config_path = ONNX_OUTPUT_DIR / "config.json"

    with open(config_path) as f:
        config = json.load(f)

    # Match the structure from onnx-community/Qwen3.5-0.8B-Text-ONNX
    config["transformers.js_config"] = {
        "use_external_data_format": {
            "model.onnx": 2,
            "model": 1,
        },
        "kv_cache_dtype": {
            "q4f16": "float16",
            "fp16": "float16",
        },
    }

    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    print("  OK Config patched for transformers.js")

    # Show final file listing
    print("\n  Final output files:")
    for p in sorted(ONNX_OUTPUT_DIR.rglob("*")):
        if p.is_file():
            size_mb = p.stat().st_size / (1024 * 1024)
            print(f"    {p.relative_to(ONNX_OUTPUT_DIR)} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    print("Qwen3.5-2B Text-Only ONNX Conversion")
    print("=" * 50)

    step1_extract_text_backbone()
    step2_export_onnx()
    step3_quantize()
    step4_patch_config()

    print("\n Done! Output in:", ONNX_OUTPUT_DIR)
    print("Next: huggingface-cli upload ttslab/Qwen3.5-2B-Text-ONNX", ONNX_OUTPUT_DIR)
