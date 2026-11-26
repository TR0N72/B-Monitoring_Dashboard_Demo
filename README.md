# B-Monitor

Water-quality monitoring for brackish-water milkfish (bandeng) ponds, built as a Capstone project at Teknik Komputer, Universitas Diponegoro (topic: ESP32-based monitoring, Juwana coast).

A sensor node measures temperature and salinity, a gateway forwards the data over MQTT, and this repo's software stores it, scores pond risk with a fuzzy decision-support system (DSS), classifies water turbidity from camera images, sends Telegram alerts and controls pumps and valves.

```
Node N1 --LoRa E32--> Gateway ESP32 --MQTT--> Mosquitto --> Backend (Express) --> MySQL
                                                              |-> Telegram
                                                              |-> AI service (FastAPI)
                                       Frontend (Next.js) <---+    Grafana <-- MySQL
```

## Scope of this repository

This repo holds the **software**: backend, frontend, AI service, database, broker and Grafana config. Firmware (`penerima.ino` and the node sketch) is maintained by the hardware team and is not in this repo. The wire contract between firmware, AI and backend is in [docs/HW_AI_CONTRACT.md](docs/HW_AI_CONTRACT.md).

| Area | Owner | Status |
|---|---|---|
| Backend, frontend, DB, Docker, Grafana | Fullstack | Running, 183 Jest tests pass |
| AI image classifier integration | Fullstack + AI | Integrated, model supplied by the AI engineer |
| Firmware and sensors | Hardware | Live test pending (gateway cannot reach the broker yet, see [Known issues](#known-issues)) |

## Services

| Service | Container | Host port | Notes |
|---|---|---|---|
| Reverse proxy (nginx) | `bmonitor-nginx` | 8080 | Single entry point: `/` dashboard, `/api`, `/ws`, `/grafana` (login required) |
| Frontend (Next.js 16, React 19) | `bmonitor-frontend` | internal only | Dashboard, vanilla CSS. Reached through nginx on 8080 |
| Backend (Express) | `bmonitor-backend` | 127.0.0.1:3001 | REST, Socket.IO, MQTT client. Health: `/api/health` |
| MySQL 8 | `bmonitor-mysql` | none | Reach it with `docker exec` |
| Mosquitto 2 | `bmonitor-mosquitto` | 1883, 9001 | Auth and ACL required |
| Grafana | `bmonitor-grafana` | 127.0.0.1:3000 | Provisioned dashboards |
| AI service (FastAPI) | `bmonitor-ai` | none | Internal only, `http://ai:8000` |

## Quick start

Requirements: Docker Desktop (Compose v2). Node 20+ only if you run tests outside Docker.

```bash
git clone https://github.com/TR0N72/B-Monitoring_Dashboard_Demo.git
cd B-Monitoring_Dashboard_Demo
cp .env.example .env        # then edit every "change-me"
```

Create the broker accounts. `docker/mosquitto/passwd` is git-ignored, so each machine needs its own. The usernames must match [docker/mosquitto/acl](docker/mosquitto/acl):

```bash
docker run --rm -v "$PWD/docker/mosquitto:/c" eclipse-mosquitto:2 \
  mosquitto_passwd -c -b /c/passwd bmonitor_backend '<MQTT_PASSWORD from .env>'
docker run --rm -v "$PWD/docker/mosquitto:/c" eclipse-mosquitto:2 \
  mosquitto_passwd -b /c/passwd hw_gateway '<password for the gateway firmware>'
```

Start everything (run from the repo root, where `docker-compose.yml` is):

```bash
docker compose up -d --build
curl http://localhost:3001/api/health
```

Open http://localhost:8080/login (from another device on the LAN: `http://<laptop-IP>:8080/login`). The frontend has no host port of its own, so always go through 8080. The first run seeds one admin user, `admin`, from `docker/mysql/init.sql`. The seed stores only a bcrypt hash, so set your own password:

```bash
docker exec -e NEWPW='YourNewPassword' bmonitor-backend node -e "const b=require('bcryptjs');process.stdout.write(b.hashSync(process.env.NEWPW,10))" > hash.txt
docker exec -i bmonitor-mysql sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" $MYSQL_DATABASE -e "UPDATE users SET password_hash=\"$(cat)\" WHERE username=\"admin\""' < hash.txt
rm hash.txt
```

Stop with `docker compose down`. Never add `-v`: it deletes the MySQL volume.

## Try it without hardware

`scripts/sim_node.js` publishes fake telemetry. It needs `mqtt` and `dotenv`, so set `NODE_PATH`. It reads `MQTT_USER`/`MQTT_PASSWORD` from `.env` and connects to `MQTT_BROKER_URL` (default `mqtt://localhost:1883`). Use the backend account only for local tests, never on a shared network.

```bash
NODE_PATH=backend/node_modules node scripts/sim_node.js N1 5 2000 normal   # node, count, interval ms, normal|hot|anomaly
NODE_PATH=backend/node_modules node scripts/sim_ai.js N1 Normal 0.9        # node, label, confidence
```

Messages for a `node_id` that is not in the `devices` table are dropped, and simulated rows are stored like real ones. Use a throwaway database or delete them afterwards.

## Commands

| Where | Command | Purpose |
|---|---|---|
| `backend/` | `npm test` | Jest, 10 suites, 183 tests |
| `backend/` | `npm run test:security` | Security suite only |
| `backend/` | `npm run dev` | Backend with `--watch` (needs MySQL and MQTT reachable) |
| `frontend/` | `npm run dev` / `build` / `lint` | Next.js dev, production build, ESLint |

Tests need no database or broker.

## Configuration

All settings live in `.env` (template: [.env.example](.env.example)). Values that matter most:

| Variable | Default | Meaning |
|---|---|---|
| `JWT_SECRET` | none | Required. Signs login tokens |
| `MQTT_USER` / `MQTT_PASSWORD` | none | Backend account on the broker |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | empty | Alerts. Empty disables Telegram |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | Used only by `scripts/sim_*.js` |
| `CYCLE_INTERVAL_MIN` | empty (off) | Minutes between automatic `START_CYCLE`. Leave off until an operator can reach the hardware |
| `DEVICE_OFFLINE_SEC` | 90 | Seconds without data before a device turns `offline` |
| `AI_MIN_CONFIDENCE` | 0.6 | AI results below this are stored but not used by the DSS |
| `CHAMBER_NODES` | `N1` | Nodes that can raise a BAHAYA (danger) notification |

After changing `.env` or backend code, recreate the container: `docker compose up -d --build backend`.

## Repository layout

```
backend/            Express API, MQTT client, services, Jest tests
  src/routes/       auth, users, devices, sensors, thresholds, logs, notifications, actuator, fuzzy (dss), ai
  src/services/     fuzzyDSS, actuatorController, emergencyState, cycleScheduler, deviceStatus, aiDetection
  src/config/       db, mqtt, telegram, telegramQueue
frontend/           Next.js app (dashboard, sensors, actuator, DSS, AI vision, users, analytics)
ai-service/         FastAPI service and the trained model (.joblib)
docker/             Mosquitto config and ACL, MySQL init.sql, Grafana provisioning
scripts/            Hardware and AI simulators
docs/               Architecture, API reference, hardware/AI contract
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): data flow, MQTT topics, database, fuzzy DSS, safety logic.
- [docs/API.md](docs/API.md): REST endpoints and roles.
- [docs/HW_AI_CONTRACT.md](docs/HW_AI_CONTRACT.md): payloads agreed with hardware and AI.

## Security notes

- Secrets live only in `.env` and `docker/mosquitto/passwd`, both git-ignored. Do not paste them into issues or chat.
- Broker ACL is default deny. `hw_gateway` may only publish sensor and actuator status and read actuator commands.
- Login is rate limited (10 per 15 minutes) and the token is an `httpOnly` cookie.
- Never send actuator commands while the gateway is offline: they are not queued, and an unacknowledged command stays `pending` until it expires. Test with `EMERGENCY_STOP` first, with an operator next to the equipment.
- The AI model is loaded with `joblib`, which can execute code. Only load model files you trust.

## Team

Fullstack (backend, frontend, database, infrastructure): Hafiizh, NIM 21120123130094. Hardware and AI are delivered by separate team members.

## Known issues

- **Gateway to broker.** The gateway firmware points at a fixed broker IP that changes when the laptop changes network. Data stopped on 2026-11-17. Use a fixed IP on a private router or hotspot and reflash. A real `START_CYCLE` test is pending.
- **Sensor change.** The pH sensor was dropped. `jarak_cm` (ultrasonic distance from sensor to water surface) is stored and shown, with no threshold or alert yet because the prototype geometry is not verified. The `ph_level` column is removed by an automatic migration at backend start, and a `ph` field in a payload is ignored.
- **`operator` role.** Some endpoints allow `admin` or `operator`, but `users.role` only stores `admin` or `user`, so only admins can use them in practice.
- **Seed data.** `init.sql` still seeds four demo devices (`ESP32-NODE-01..03`, `LORA-GW-01`) next to `N1`. Delete them in the Sensor Nodes page if you do not want them.
- **Lockfiles.** `package-lock.json` files carry line-ending noise from Windows.
- **AI accuracy.** The model is validated on 50 test images (50 correct), cross-validated accuracy 80.8%. Real pond photos are not evaluated yet.
