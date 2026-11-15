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

## Gateway N1 (jawaban final untuk hardware)
- Sensor `tambak/N1/sensor`: `{"node":"N1","seq":123,"suhu":27.21,"sal_ppt":8.37,"adc":3117,"jarak_cm":30.0,"status":"IDLE"}`
  - `sal_ppt` = alias `salinitas`. `seq/adc/jarak_cm/status` disimpan (kolom `seq,adc,jarak_cm,siklus_status`).
  - Nilai kosong kirim `null`. Minimal satu dari suhu/salinitas/baterai harus angka, kalau tidak pesan dibuang.
  - `status` IDLE|FILL|SETTLE|MEASURE|DRAIN. Semua baris disimpan; alert/fuzzy hanya jalan saat IDLE/DRAIN (atau status kosong).
- Perintah `tambak/N1/actuator/command`: `{"aksi":"START_MEASURE","cmd":"m","command_id":48}`
  - cmd: f=isi, k=kuras, m=ukur, x=isi+ukur, c=siklus penuh, s=stop.
- Ack: publish ke `tambak/N1/actuator/status` `{"command_id":48,"status":"executed"}`.
