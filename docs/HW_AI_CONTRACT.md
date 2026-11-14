# Hardware / AI interface contract (as implemented by backend)

| Direction | Topic | Payload (JSON) |
|---|---|---|
| HW -> backend | `tambak/{node_id}/sensor` | `suhu, ph, salinitas, kekeruhan, baterai, rssi` (numbers) |
| HW -> backend | `tambak/{node_id}/sensor/vibration` | vibration reading (failsafe) |
| HW -> backend | `tambak/{node_id}/actuator/status` | actuator confirmation |
| AI -> backend | `tambak/{node_id}/camera/result` | `label` Normal/Caution/Warning, `confidence` 0-1, `model_version`, `hsv_metadata{}` |
| AI -> backend (alt) | `POST /api/ai/detections` (JWT) | same fields + `node_id` |
| backend -> camera | `tambak/{node_id}/camera/capture` | `request_id, action:"capture_and_analyze"` |

- `node_id` must exist in table `devices`, else message is dropped.
- Spec topic `tambak/{node}/sensor/{parameter}` is NOT implemented; HW must send one aggregate payload per node.
- Read results: `GET /api/ai/detections?device_id=&label=&limit=`; socket event `ai:detection`.
- Simulators: `scripts/sim_node.js`, `scripts/sim_ai.js`.
