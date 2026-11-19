# API

Base URL: `http://localhost:3001`. Every `/api` route is rate limited to 300 requests/minute per IP. All routes except `/api/health`, `/api/auth/login` and `/api/auth/logout` need a JWT (`Authorization: Bearer <token>` or the auth cookie set by login). `admin` = admin only. `admin/operator` is declared in code, but the DB role enum is `admin`/`user`, so in practice it means admin only.

Rules are taken from `backend/src/routes/*.routes.js` and `server.js`.

## Health

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | none | Liveness check |

## Auth (`/api/auth`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/login` | none | Login. Limited to 10 attempts per 15 minutes |
| POST | `/logout` | none | Clear the auth cookie |
| POST | `/register` | admin | Create a user |
| GET | `/me` | any | Current user |

## Users (`/api/users`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/` | admin | List users |
| POST | `/` | admin | Create user |
| PUT | `/:id` | admin | Update user |
| DELETE | `/:id` | admin | Delete user |

## Devices (`/api/devices`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/` | any | List devices |
| GET | `/:id` | any | One device |
| POST | `/` | admin | Create device |
| PUT | `/:id` | admin | Edit name/location/status. `node_id` cannot change |
| DELETE | `/:id` | admin | Delete device (cascades to its data) |

Status goes `offline` automatically after `DEVICE_OFFLINE_SEC` seconds without data and back to `online` when MQTT data arrives. `maintenance` is never changed automatically.

## Sensors (`/api/sensors`)

| Method | Path | Query | Purpose |
|---|---|---|---|
| GET | `/latest` | `device_id` | Latest reading per node |
| GET | `/history` | `device_id, parameter, start_date, end_date, limit` | History. `parameter` is one of `suhu, salinitas, turbidity, baterai, rssi, jarak_cm`; without `parameter` the response is `{ data: [rows], query }`; with it, `data` holds `{ _time, _value, _field }` items |

`jarak_cm` is the ultrasonic distance from the sensor to the water surface. It is stored and shown only: there is no distance threshold.

## Thresholds (`/api/config/thresholds`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/` | any | All thresholds |
| GET | `/:deviceId` | any | Thresholds of one device |
| PUT | `/:deviceId` | admin | Replace thresholds. Body `{ "thresholds": [{ "parameter", "batas_bawah", "batas_atas" }] }`, `parameter` in `suhu, salinitas, turbidity` |

## Logs (`/api/logs`)

| Method | Path | Query | Purpose |
|---|---|---|---|
| GET | `/` | `page, limit (max 100), level, device_id, start_date, end_date` | Alert log, paged |
| GET | `/export` | `type (default telemetry), device_id, start_date, end_date, columns` | CSV export. `type` is `telemetry` or alerts. `columns` (telemetry only) is a comma list of `suhu, salinitas, turbidity, baterai, rssi, jarak`. Response is `text/csv` |

## Actuator (`/api/actuator`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/command` | admin | Body `{ "device_id", "aksi" }`. `aksi` is one of `OPEN_DRAIN_VALVE, CLOSE_DRAIN_VALVE, OPEN_FILL_VALVE, CLOSE_FILL_VALVE, PUMP_ENGINE_START, PUMP_ENGINE_STOP, EMERGENCY_STOP, START_MEASURE, FILL_AND_MEASURE, START_CYCLE` |
| GET | `/logs` | any | Command history |
| GET | `/status/:device_id` | any | Actuator state of a device |
| GET | `/emergency/status` | any | Emergency-stop state |
| POST | `/emergency/reset/:device_id` | admin | Clear emergency state |
| GET | `/notifications/queue` | admin | Pending Telegram queue |

A command is published to `tambak/{node_id}/actuator/command` (QoS 1) and stays `pending` until the gateway acknowledges on `.../actuator/status`. Do not send commands while the gateway is offline. Only send `START_CYCLE` when someone is next to the hardware and ready to send `EMERGENCY_STOP`.

## Fuzzy DSS (`/api/dss`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Stored fuzzy decisions |
| GET | `/rules` | The 27 rules and membership definitions |
| POST | `/simulate` | Run the fuzzy engine on a given input without saving |

## AI (`/api/ai`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/analyze?node_id=N1` | admin/operator | Raw image body (`image/*`, max 5 MB). Forwarded to the `ai` service. Bad photo quality returns 422 with `reason` |
| POST | `/detections` | admin/operator | Save a detection from an external source |
| POST | `/capture` | admin/operator | Save a capture-based detection |
| GET | `/detections` | any | Detection history |

Valid labels are `Normal`, `Caution`, `Warning`. A result below `AI_MIN_CONFIDENCE` (default 0.60) is stored but not used by the DSS.

## Notifications (`/api/notifications`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/trigger` | admin/operator | Send a manual alert. Rate limited |
| POST | `/test-telegram` | admin | Send a Telegram test message |
| GET | `/telegram-status` | any | Bot configuration status |

## Socket.IO

Path `/ws`, same port as the API. The JWT goes in the cookie, `auth.token`, or an `Authorization: Bearer` header. Server events: `sensor_update`, `dss:update`, `new_alert`, `alert_acknowledged`, `device_status`, `actuator:status`, `actuator:confirmed`, `system:status`, `system:emergency`, `sensor:vibration`, `ai:detection`, `status` (reply to `request_status`). Client events: `request_status`, `acknowledge_alert`.
