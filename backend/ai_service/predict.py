"""
predict.py — XGBoost Inference Service untuk B-Monitor
=======================================================
Script ini dijalankan sebagai child process oleh Node.js backend melalui aiService.js.

Protokol Komunikasi (stdio):
  INPUT  (stdin)  : JSON satu baris berisi objek fitur visual
  OUTPUT (stdout) : JSON satu baris berisi hasil inferensi
  ERROR  (stderr) : Pesan diagnostik / log

Format Input JSON:
  {
    "mean_h"          : float,   // Rata-rata Hue (0-179)
    "mean_s"          : float,   // Rata-rata Saturation (0-255)
    "mean_v"          : float,   // Rata-rata Value/Brightness (0-255)
    "green_ratio"     : float,   // Proporsi piksel hijau (0.0-1.0)
    "edge_density"    : float,   // Kepadatan tepi ternormalisasi (0.0-1.0)
    "intensity_variance": float  // Variansi intensitas piksel
  }

Format Output JSON (sukses):
  {
    "status"      : "ok",
    "label"       : "Normal" | "Caution" | "Warning",
    "label_id"    : 0 | 1 | 2,
    "confidence"  : float,       // Probabilitas kelas prediksi (0.0-1.0)
    "probabilities": {           // Probabilitas semua kelas
      "Normal"  : float,
      "Caution" : float,
      "Warning" : float
    },
    "model_version": str         // Versi model dari file
  }

Format Output JSON (error):
  {
    "status"  : "error",
    "message" : str
  }

Mode Operasi:
  Standar    : Baca satu baris dari stdin, proses, tulis ke stdout, exit.
  Persistent : Jalankan dengan argumen --persistent untuk mode loop
               (membaca baris demi baris tanpa restart process).
"""

import sys
import json
import os
import logging

# ── Suppress verbose logs dari libraries ke stderr ──────────────────────────
logging.basicConfig(level=logging.ERROR, stream=sys.stderr)
os.environ["PYTHONUNBUFFERED"] = "1"

import numpy as np
import joblib

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────
LABEL_MAP     = {0: "Normal", 1: "Caution", 2: "Warning"}
FEATURE_ORDER = ["mean_h", "mean_s", "mean_v", "green_ratio", "edge_density", "intensity_variance"]
MODEL_VERSION = "xgb-v1.0-bootstrap"

# ─────────────────────────────────────────────────────────────────────────────
# Model Loading
# ─────────────────────────────────────────────────────────────────────────────
_service_dir = os.path.dirname(os.path.abspath(__file__))
_model_path  = os.path.join(_service_dir, "model.joblib")
_scaler_path = os.path.join(_service_dir, "scaler.joblib")

def _load_artifacts():
    """Muat model dan scaler dari disk. Raise RuntimeError jika tidak ditemukan."""
    if not os.path.exists(_model_path):
        raise RuntimeError(
            f"Model file not found: {_model_path}\n"
            "Run 'python train_model.py' first to generate model artifacts."
        )
    if not os.path.exists(_scaler_path):
        raise RuntimeError(
            f"Scaler file not found: {_scaler_path}\n"
            "Run 'python train_model.py' first to generate scaler artifacts."
        )

    model  = joblib.load(_model_path)
    scaler = joblib.load(_scaler_path)

    # Versi model dari metadata joblib jika ada
    version = getattr(model, "_bmonitor_version", MODEL_VERSION)
    print(f"[AI Service] Model loaded: {version}", file=sys.stderr)
    return model, scaler, version

# ─────────────────────────────────────────────────────────────────────────────
# Inference Logic
# ─────────────────────────────────────────────────────────────────────────────
def validate_features(data: dict) -> list:
    """
    Validasi dan ekstrak fitur dari dict input.
    Mengembalikan list fitur dalam urutan FEATURE_ORDER.
    Raises ValueError untuk field yang hilang atau nilai di luar rentang.
    """
    missing = [f for f in FEATURE_ORDER if f not in data]
    if missing:
        raise ValueError(f"Missing required features: {missing}")

    features = []
    for key in FEATURE_ORDER:
        val = data[key]
        if not isinstance(val, (int, float)):
            raise ValueError(f"Feature '{key}' must be numeric, got {type(val).__name__}")
        features.append(float(val))

    # Sanity checks untuk rentang fisik
    if not (0 <= features[0] <= 179):
        raise ValueError(f"mean_h must be in [0, 179], got {features[0]}")
    if not (0 <= features[1] <= 255):
        raise ValueError(f"mean_s must be in [0, 255], got {features[1]}")
    if not (0 <= features[2] <= 255):
        raise ValueError(f"mean_v must be in [0, 255], got {features[2]}")
    if not (0 <= features[3] <= 1):
        raise ValueError(f"green_ratio must be in [0, 1], got {features[3]}")
    if not (0 <= features[4] <= 1):
        raise ValueError(f"edge_density must be in [0, 1], got {features[4]}")

    return features


def infer(model, scaler, model_version: str, data: dict) -> dict:
    """Jalankan inferensi XGBoost dan kembalikan dict hasil."""
    features     = validate_features(data)
    X            = np.array([features])
    X_scaled     = scaler.transform(X)

    label_id     = int(model.predict(X_scaled)[0])
    probas       = model.predict_proba(X_scaled)[0]
    confidence   = float(probas[label_id])

    return {
        "status"       : "ok",
        "label"        : LABEL_MAP[label_id],
        "label_id"     : label_id,
        "confidence"   : round(confidence, 4),
        "probabilities": {
            "Normal"  : round(float(probas[0]), 4),
            "Caution" : round(float(probas[1]), 4),
            "Warning" : round(float(probas[2]), 4),
        },
        "model_version": model_version,
    }


def emit_result(result: dict):
    """Tulis JSON ke stdout dan flush segera."""
    print(json.dumps(result, ensure_ascii=False), flush=True)


def emit_error(message: str):
    """Tulis JSON error ke stdout."""
    emit_result({"status": "error", "message": message})


# ─────────────────────────────────────────────────────────────────────────────
# Entry Points
# ─────────────────────────────────────────────────────────────────────────────
def run_once(model, scaler, model_version: str):
    """Baca satu baris JSON dari stdin, proses, tulis ke stdout."""
    try:
        raw_input = sys.stdin.readline()
        if not raw_input:
            emit_error("No input received from stdin.")
            return

        data = json.loads(raw_input.strip())
        result = infer(model, scaler, model_version, data)
        emit_result(result)

    except json.JSONDecodeError as e:
        emit_error(f"Invalid JSON input: {e}")
    except ValueError as e:
        emit_error(f"Feature validation error: {e}")
    except Exception as e:
        emit_error(f"Inference failed: {e}")


def run_persistent(model, scaler, model_version: str):
    """
    Mode loop — baca baris JSON terus-menerus dari stdin tanpa restart.
    Berguna jika Node.js menggunakan satu process yang persisten.
    """
    print("[AI Service] Running in persistent mode. Waiting for input...", file=sys.stderr)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if line.lower() in ("quit", "exit"):
            break
        try:
            data   = json.loads(line)
            result = infer(model, scaler, model_version, data)
            emit_result(result)
        except json.JSONDecodeError as e:
            emit_error(f"Invalid JSON input: {e}")
        except ValueError as e:
            emit_error(f"Feature validation error: {e}")
        except Exception as e:
            emit_error(f"Inference failed: {e}")


def main():
    try:
        model, scaler, model_version = _load_artifacts()
    except RuntimeError as e:
        emit_error(str(e))
        sys.exit(1)

    persistent_mode = "--persistent" in sys.argv
    if persistent_mode:
        run_persistent(model, scaler, model_version)
    else:
        run_once(model, scaler, model_version)


if __name__ == "__main__":
    main()
