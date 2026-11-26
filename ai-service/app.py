"""TSS2 water-image classifier service. Preprocessing + features copied from the AI team's
streamlit_app_matched.py (Experiment 11, HistGradientBoosting, fixed MI-18 features)."""
import io
import warnings
from pathlib import Path

import cv2
import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from PIL import Image
from skimage.feature import graycomatrix, graycoprops

MODEL_PATH = Path(__file__).resolve().parent / "tss2_deployment_model.joblib"
MODEL_VERSION = "TSS2_HGB_exp11"
MAX_BYTES = 5 * 1024 * 1024
IMAGE_SIZE = (128, 128)
MAX_PIXELS = 12_000_000  # ESP32-CAM tops out at 2 MP; reject decompression bombs before decoding
FEATURES = ["glcm_contrast", "glcm_correlation", "glcm_energy", "h_mean", "h_std", "h_var",
            "h_hist_0", "h_hist_1", "h_hist_4", "s_mean", "s_hist_0", "s_hist_1", "v_mean",
            "v_std", "v_var", "v_hist_4", "v_hist_5", "h_hist_5"]
# 5 TSS classes -> backend labels (from AI team's Streamlit app).
CLASS_TO_LABEL = {1: "Normal", 2: "Normal", 3: "Caution", 4: "Caution", 5: "Warning"}

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    bundle = joblib.load(MODEL_PATH)  # trusted file shipped with repo
assert list(bundle["features"]) == FEATURES, "feature order mismatch"
model = bundle["model"]

app = FastAPI(title="B-Monitor AI service")


def hist8(v):
    h, _ = np.histogram(v, bins=8, range=(0, 1))
    h = h.astype(np.float32)
    return h / h.sum() if h.sum() > 0 else h


def features(rgb):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    glcm = graycomatrix((gray // 32).astype(np.uint8), distances=[1], angles=[0, np.pi / 2],
                        levels=8, symmetric=True, normed=True)
    f = {f"glcm_{p}": float(np.mean(graycoprops(glcm, p))) for p in ("contrast", "correlation", "energy")}
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.float32)
    hsv[:, :, 0] /= 179.0
    hsv[:, :, 1:] /= 255.0
    for i, c in enumerate("hsv"):
        v = hsv[:, :, i]
        f[f"{c}_mean"], f[f"{c}_std"], f[f"{c}_var"] = float(v.mean()), float(v.std()), float(v.var())
        for b, x in enumerate(hist8(v)):
            f[f"{c}_hist_{b}"] = float(x)
    return pd.DataFrame([[f[k] for k in FEATURES]], columns=FEATURES)


@app.get("/health")
def health():
    return {"status": "ok", "model_version": MODEL_VERSION}


@app.post("/predict")
async def predict(request: Request):
    """Body = raw image bytes (jpeg/png). Returns backend label + confidence."""
    data = await request.body()
    # CPU berat (OpenCV/GLCM/model) di threadpool agar event loop dan /health tidak terblok
    return await run_in_threadpool(_predict, data)


def _predict(data: bytes):
    if not data:
        raise HTTPException(400, "empty body")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "image too large")
    try:
        with Image.open(io.BytesIO(data)) as im:  # header only, no pixel decode
            w, h = im.size
    except Exception:
        raise HTTPException(400, "not a decodable image")
    if w * h > MAX_PIXELS:
        raise HTTPException(413, "image dimensions too large")
    bgr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        raise HTTPException(400, "not a decodable image")
    small = cv2.resize(bgr, IMAGE_SIZE, interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
    x = features(rgb)
    proba = model.predict_proba(x)[0]
    pred = str(model.predict(x)[0])
    try:
        n = int(float(pred.lower().replace("class", "").replace("_", " ").strip()))
    except ValueError:
        raise HTTPException(500, f"unexpected class '{pred}'")
    return {"label": CLASS_TO_LABEL[n], "confidence": round(float(proba.max()), 4),
            "model_version": MODEL_VERSION,
            "hsv_metadata": {"predicted_class": f"Class {n}", "h_mean": float(x["h_mean"][0]),
                             "s_mean": float(x["s_mean"][0]), "v_mean": float(x["v_mean"][0])}}
