FROM node:20-slim

# ── Install Python 3 + pip untuk AI microservice ──────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Install Node.js dependencies ──────────────────────────────────────────
COPY package*.json ./
RUN npm install --production

# ── Install Python dependencies untuk AI service ──────────────────────────
COPY ai_service/requirements.txt ./ai_service/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r ./ai_service/requirements.txt

# ── Copy seluruh source code ───────────────────────────────────────────────
COPY . .

# ── Bootstrap model XGBoost jika belum ada ────────────────────────────────
# Model di-train satu kali saat build. Jika model.joblib sudah ada di repo
# (dari Tim AI), tahap ini akan di-skip karena model tidak di-overwrite.
RUN if [ ! -f ./ai_service/model.joblib ]; then \
      echo "Training bootstrap XGBoost model..." && \
      python3 ./ai_service/train_model.py; \
    else \
      echo "Model artifact found, skipping bootstrap training."; \
    fi

EXPOSE 3001
CMD ["node", "src/server.js"]