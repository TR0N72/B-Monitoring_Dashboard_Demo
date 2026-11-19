# Architecture

## Data flow

```
Node N1 --LoRa E32--> Gateway ESP32 --MQTT--> Mosquitto --> Backend --> MySQL
                                                  ^            |-> Socket.IO --> Frontend
                                                  |            |-> Telegram queue
                                          actuator commands    |-> AI service (HTTP)
```

1. Node N1 measures temperature, salinity, ADC and water distance and sends one LoRa line every ~10 s: `BMON,N1,seq,suhu,sal,adc,jarak,status`.
2. The gateway (`penerima.ino`) republishes it as JSON to `tambak/N1/sensor`.
3. The backend subscribes, validates, stores the row in `sensor_data`, runs the fuzzy DSS, raises alerts and pushes updates to the browser over Socket.IO.
4. Operators or the DSS send actuator commands to `tambak/N1/actuator/command`. The gateway acknowledges on `tambak/N1/actuator/status`.

## MQTT topics

| Topic | Direction | Payload |
|---|---|---|
| `tambak/{node}/sensor` | gateway to backend | `node, seq, suhu, sal_ppt` (alias of `salinitas`), `adc, jarak_cm, status`; also `kekeruhan, baterai, rssi`. `jarak_cm` is the ultrasonic distance from the sensor to the water surface (not water depth). A `ph` field is ignored with a log warning. Prototype geometry (unverified): depth = 40 - `jarak_cm`; firmware sends `NA` outside 22-100 cm. The backend only stores and displays distance; it has no distance threshold or alert |
| `tambak/{node}/sensor/vibration` | gateway to backend | vibration reading for failsafe verification |
| `tambak/{node}/actuator/command` | backend to gateway | `{"aksi":"START_MEASURE","cmd":"m","command_id":48}` |
| `tambak/{node}/actuator/status` | gateway to backend | `{"command_id":48,"status":"executed"}` |
| `tambak/{node}/camera/result` | AI to backend | `label, confidence, model_version, hsv_metadata` |

Rules:

- `node` must exist in `devices`, otherwise the message is dropped.
- `null` values are stored as NULL. At least one of temperature, salinity or battery must be a number.
- The backend sets the timestamp. The gateway's clock is not trusted.
- `cmd` is one letter: `f` fill, `k` drain, `m` measure, `x` fill and measure, `c` full cycle, `s` stop.
- `status` is the node cycle state: `IDLE`, `FILL`, `SETTLE`, `MEASURE`, `DRAIN`. All rows are stored. Alerts and the DSS run only on `IDLE`, `DRAIN` or empty status.

Full agreed payloads: [HW_AI_CONTRACT.md](HW_AI_CONTRACT.md).

## Broker access control

`docker/mosquitto/acl` is default deny.

| User | Access |
|---|---|
| `bmonitor_backend` | read and write `tambak/#` |
| `hw_gateway` | write `tambak/+/sensor`, `tambak/+/sensor/#`, `tambak/+/actuator/status`; read `tambak/+/actuator/command` |

The AI engineer's MQTT account is not created yet. The backend calls the AI service over HTTP instead.

## Database (MySQL 8)

Schema in `docker/mysql/init.sql`. The backend also creates `ai_detection_logs` at startup if it is missing and retries the connection 5 times, 3 s apart.

| Table | Purpose |
|---|---|
| `users` | accounts, `role` is `admin` or `user` |
| `devices` | nodes and gateways, `node_id`, `status`, `last_seen` |
| `sensor_data` | telemetry: `suhu, salinitas, turbidity, baterai, rssi, seq, adc, jarak_cm, siklus_status, recorded_at` |
| `threshold_config` | per-device lower and upper limits per parameter |
| `alert_logs` | alerts with level and message |
| `fuzzy_decisions` | DSS score, recommendation, fired rules |
| `actuator_logs` | commands, trigger source, `pending` / executed / failed |
| `ai_detection_logs` | AI label, confidence, model version |

Timestamps are stored in UTC. Local time (WIB) is UTC+7.

Backup and restore:

```bash
docker exec bmonitor-mysql sh -c 'mysqldump --single-transaction -u root -p"$MYSQL_ROOT_PASSWORD" $MYSQL_DATABASE' > backup.sql
docker exec -i bmonitor-mysql sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" $MYSQL_DATABASE' < backup.sql
```

Rebuilding containers keeps the `mysql_data` volume. If `init.sql` re-runs on a fresh volume, restore your dump afterwards.

## Fuzzy decision-support system

`backend/src/services/fuzzyDSS.js`. Inputs: temperature, salinity, visual label (from AI). Output: score 0-100 and a recommendation. 27 IF-THEN rules (3 x 3 x 3), listed at `GET /api/dss/rules`.

- Score >= 36 is Waspada (warning). Score >= 66 is Bahaya (danger).
- Temperature: normal 28.5-31.5 C. Warning below 25 or above 32. Danger below 23 or above 35.
- Salinity: 0-5 ppt normal. Warning from 8 ppt. Full danger at 10 ppt and above.
- Turbidity comes only from the AI label, never from a sensor.
- High temperature or salinity still triggers Bahaya when the visual label is `Normal`.
- A Bahaya notification is sent only for chamber nodes (`CHAMBER_NODES`, default `N1`).
- `POST /api/dss/simulate` runs the DSS on manual values without storing anything.

## Actuator control and safety

`actuatorController.js`, `emergencyState.js`, `cycleScheduler.js`.

- Each command is stored in `actuator_logs` as `pending` with a `command_id`, then published. The gateway's ack closes it.
- Pending commands expire after 15 minutes (`START_CYCLE`) or 12 minutes (others).
- Cooldown between automatic actions: `ACTUATOR_COOLDOWN_MS` (10 min). Delay between sequence steps: `ACTUATOR_STEP_DELAY_MS` (30 s).
- Failsafe: after an emergency stop the backend waits `FAILSAFE_VERIFY_WINDOW_MS` (15 s) for vibration below `VIBRATION_THRESHOLD`. Reset with `POST /api/actuator/emergency/reset/:device_id` (admin).
- Scheduler: one global interval (`CYCLE_INTERVAL_MIN`), off by default. It skips a node when an emergency is active, a cycle is already running, or the last `START_CYCLE` is unacknowledged.

## Device status

`deviceStatus.js` runs every 30 s and marks a device `offline` after `DEVICE_OFFLINE_SEC` (90) without data. Incoming MQTT data sets it back to `online`. `maintenance` is never changed automatically.

## Telegram

`telegramQueue.js` queues messages with rate limiting and retries (Caution 5, Warning 10, Failsafe unlimited). Alerts for the same condition respect `ALERT_COOLDOWN_MS` (5 min). Alerts go to one supergroup.

## AI service

`ai-service/app.py` (FastAPI, port 8000, container-internal). Model `TSS2_HGB_exp11` (scikit-learn HistGradientBoosting), labels `Normal`, `Caution`, `Warning`. Cross-validated accuracy 80.81%, macro F1 81.05%.

- The backend forwards an uploaded image to the service at `POST /api/ai/analyze?node_id=N1` (JWT, max 5 MB).
- Poor images (blur, too dark, too small) get HTTP 422 with a `reason`. Images above 12 million pixels are rejected.
- Results below `AI_MIN_CONFIDENCE` (0.6) are stored with `used_for_dss=false`.
- A label is valid for the DSS for 30 minutes.
- Model inference runs in a threadpool so `/health` stays responsive.

## Frontend

Next.js 16, React 19, vanilla CSS with theme variables, no UI libraries. Pages: dashboard (one card per node, stale after 60 s), sensors (CRUD, edit, 15 s refresh), actuator, DSS, AI vision, analytics (embedded Grafana), config, users, export, support. The browser talks to the backend at `http://localhost:3001`.

## Grafana

Dashboards `bmonitor-main.json` and `bmonitor-telemetry.json` are provisioned from `docker/grafana/provisioning`. Default time range is the last 7 days. Anonymous viewing and embedding are enabled for the Analytics page, so do not expose port 3000 outside a trusted network.
