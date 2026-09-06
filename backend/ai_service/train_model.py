"""
train_model.py — Bootstrap XGBoost model untuk B-Monitor AI Service
====================================================================
Script ini digunakan SATU KALI untuk menghasilkan model awal (model.joblib)
dan scaler (scaler.joblib) yang akan digunakan oleh predict.py.

Model mengklasifikasikan kondisi air tambak bandeng berdasarkan 6 fitur
numerik yang diekstrak dari citra visual ESP32-CAM:
  - mean_h       : Rata-rata nilai Hue (0-179 HSV)
  - mean_s       : Rata-rata nilai Saturation (0-255 HSV)
  - mean_v       : Rata-rata nilai Value/Brightness (0-255 HSV)
  - green_ratio  : Proporsi piksel hijau-kebiruan dalam frame
  - edge_density : Kepadatan tepi (Canny edge detection) ternormalisasi
  - intensity_var: Variansi intensitas cahaya keseluruhan frame

Label Output:
  0 = "Normal"  → Air jernih, kondisi optimal
  1 = "Caution" → Air mulai keruh / ada indikasi perubahan
  2 = "Warning" → Air sangat keruh / kondisi bermasalah

CATATAN: Data sintetik ini meniru distribusi visual air tambak bandeng.
         Gantikan dengan model final dari Tim AI (Jasmine) saat tersedia.

Cara menjalankan (di dalam direktori ai_service):
  pip install -r requirements.txt
  python train_model.py
"""

import numpy as np
import joblib
import os
from xgboost import XGBClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

# ─────────────────────────────────────────────
# 1. Generate Synthetic Training Data
# ─────────────────────────────────────────────
np.random.seed(42)
N_SAMPLES = 900  # 300 per class

def generate_class_samples(n, label):
    """
    Menghasilkan sampel sintetik berdasarkan karakteristik visual
    air tambak bandeng untuk setiap kondisi.
    """
    if label == 0:  # Normal — air jernih, kehijauan alami
        mean_h        = np.random.normal(85, 10, n)     # Hue hijau-kebiruan
        mean_s        = np.random.normal(80, 20, n)     # Saturation sedang
        mean_v        = np.random.normal(160, 20, n)    # Brightness tinggi
        green_ratio   = np.random.normal(0.40, 0.08, n) # Rasio hijau tinggi
        edge_density  = np.random.normal(0.06, 0.02, n) # Tepi sedikit
        intensity_var = np.random.normal(18, 5, n)      # Variansi rendah
    elif label == 1:  # Caution — mulai keruh, phytoplankton mulai padat
        mean_h        = np.random.normal(65, 15, n)     # Hue agak kuning-hijau
        mean_s        = np.random.normal(110, 25, n)    # Saturation meningkat
        mean_v        = np.random.normal(130, 25, n)    # Brightness menurun
        green_ratio   = np.random.normal(0.28, 0.08, n) # Rasio hijau menurun
        edge_density  = np.random.normal(0.10, 0.03, n) # Tepi mulai banyak
        intensity_var = np.random.normal(32, 8, n)      # Variansi meningkat
    else:           # Warning — air sangat keruh / blooming alga / keruh coklat
        mean_h        = np.random.normal(30, 20, n)     # Hue coklat-kemerahan
        mean_s        = np.random.normal(150, 30, n)    # Saturation tinggi
        mean_v        = np.random.normal(90, 25, n)     # Brightness rendah
        green_ratio   = np.random.normal(0.12, 0.06, n) # Rasio hijau sangat rendah
        edge_density  = np.random.normal(0.16, 0.04, n) # Banyak tepi (partikel)
        intensity_var = np.random.normal(52, 12, n)     # Variansi tinggi

    # Clip ke rentang fisik yang valid
    mean_h        = np.clip(mean_h,        0, 179)
    mean_s        = np.clip(mean_s,        0, 255)
    mean_v        = np.clip(mean_v,        0, 255)
    green_ratio   = np.clip(green_ratio,   0, 1)
    edge_density  = np.clip(edge_density,  0, 1)
    intensity_var = np.clip(intensity_var, 0, 200)

    features = np.column_stack([mean_h, mean_s, mean_v, green_ratio, edge_density, intensity_var])
    labels   = np.full(n, label, dtype=int)
    return features, labels

X0, y0 = generate_class_samples(N_SAMPLES, 0)
X1, y1 = generate_class_samples(N_SAMPLES, 1)
X2, y2 = generate_class_samples(N_SAMPLES, 2)

X = np.vstack([X0, X1, X2])
y = np.concatenate([y0, y1, y2])

# ─────────────────────────────────────────────
# 2. Preprocessing
# ─────────────────────────────────────────────
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled  = scaler.transform(X_test)

# ─────────────────────────────────────────────
# 3. Train XGBoost Classifier
# ─────────────────────────────────────────────
model = XGBClassifier(
    n_estimators=150,
    max_depth=5,
    learning_rate=0.1,
    subsample=0.8,
    colsample_bytree=0.8,
    use_label_encoder=False,
    eval_metric='mlogloss',
    random_state=42,
    objective='multi:softprob',
    num_class=3,
)

print("Training XGBoost model...")
model.fit(
    X_train_scaled,
    y_train,
    eval_set=[(X_test_scaled, y_test)],
    verbose=False,
)

# ─────────────────────────────────────────────
# 4. Evaluate
# ─────────────────────────────────────────────
y_pred = model.predict(X_test_scaled)
print("\n── Classification Report ──")
print(classification_report(y_test, y_pred, target_names=["Normal", "Caution", "Warning"]))

# ─────────────────────────────────────────────
# 5. Save Artifacts
# ─────────────────────────────────────────────
output_dir = os.path.dirname(os.path.abspath(__file__))
model_path  = os.path.join(output_dir, "model.joblib")
scaler_path = os.path.join(output_dir, "scaler.joblib")

joblib.dump(model,  model_path)
joblib.dump(scaler, scaler_path)

print(f"\n✓ Model  saved → {model_path}")
print(f"✓ Scaler saved → {scaler_path}")
print("\nTraining complete. Ready for inference via predict.py")
