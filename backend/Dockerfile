FROM node:20-slim

WORKDIR /app

# ── Install Node.js dependencies ──────────────────────────────────────────
COPY package*.json ./
RUN npm install --production

# ── Copy source code ──────────────────────────────────────────────────────
COPY . .

EXPOSE 3001
CMD ["node", "src/server.js"]