# Hardware / AI interface contract (as implemented by backend)

| Direction | Topic | Payload (JSON) |
|---|---|---|
| HW -> backend | `tambak/{node_id}/sensor` | `suhu, salinitas, kekeruhan, baterai, rssi, jarak_cm` (numbers; `ph` is no longer used and is ignored) |
| HW -> backend | `tambak/{node_id}/sensor/vibration` | vibration reading (failsafe) |
| HW -> backend | `tambak/{node_id}/actuator/status` | actuator confirmation |
| AI -> backend | `tambak/{node_id}/camera/result` | `label` Normal/Caution/Warning, `confidence` 0-1, `model_version`, `hsv_metadata{}` |
| Hardware vision -> backend | `tambak/{node_id}/vision` | `{"node":"N1","kelas":"Class 4","kondisi":"Caution","confidence":0.91,"ts":...}`. `kondisi` = Normal/Caution/Warning (label of the DSS), `kelas` stored as `predicted_class`, node from the topic, `ts` ignored (server time). Stored in `ai_detection_logs` (`model_version=hw-vision`); confidence >= `AI_MIN_CONFIDENCE` feeds fuzzy DSS for 30 min. ACL: `hw_gateway` may write this topic. |
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

## Perilaku DSS dan perintah (diperbarui 2026-11-15)
- Ambang DSS (suhu, salinitas), skor 0-100: Waspada >= 36, Bahaya >= 66.
  - Suhu: normal 28,5-31,5 C; Waspada di bawah 25 atau di atas 32; Bahaya di bawah 23 atau di atas 35.
  - Salinitas: 0-5 ppt Normal (air tawar aman); Waspada mulai 8 ppt; Bahaya penuh >= 10 ppt.
  - Suhu dan salinitas tinggi tetap memicu Bahaya walau label visual `Normal` (air tidak keruh).
  - Sensor salinitas Node mendatar sekitar 8 ppt dan menahan nilai di atas 12 ppt (ADC > 3241): pembacaan 8 ppt ke atas dinilai Waspada atau Bahaya.
  - Kekeruhan/warna masuk fuzzy hanya lewat label AI kamera (`Normal`, `Caution`, `Warning`).
- Node chamber (env `CHAMBER_NODES`, default `N1`): Bahaya hanya notifikasi (dashboard + Telegram). Backend tidak mengirim perintah pompa otomatis. Perintah manual dan `START_CYCLE` dari scheduler tetap jalan.
- Perintah `pending` tanpa ack dianggap `gagal` setelah 15 menit (`START_CYCLE`) atau 12 menit (lainnya). Detail diberi akhiran `kedaluwarsa: tidak ada ack dari Gateway`.

## Analisis foto AI (diperbarui 2026-11-17)
- Model resmi: `TSS2_HGB_exp11` (HistGradientBoosting, file `tss2_deployment_model.joblib`). `model_metadata.json` (KNN) tidak dipakai.
- Jalur aktif: upload manual di halaman `/ai-vision` -> `POST /api/ai/analyze?node_id=N1` (JWT, body = gambar jpeg/png, maks 5 MB) -> service `ai` (FastAPI, internal Docker) -> `ai_detection_logs`.
  - Belum ada kamera otomatis. Input visual masih manual. Pilihan ESP32-CAM (kirim foto via HTTP ke endpoint di atas, atau kirim fitur via gateway) belum diputuskan tim hardware/AI.
- Pemetaan kelas -> label (sementara, belum divalidasi pada foto tambak): Class 1-2 `Normal`, Class 3-4 `Caution`, Class 5 `Warning`.
- Cek kualitas foto sebelum prediksi. Foto ditolak HTTP 422 dengan `reason`: `too_dark`, `too_bright`, `blank`, `blurry`. Gambar tak terbaca atau terlalu besar (> 12 juta piksel) juga 422.
- Ambang confidence 0,60 (`AI_MIN_CONFIDENCE`, usulan tim AI, belum dituning). Di bawah ambang: disimpan, respons `used_for_dss:false`, tidak dipakai fuzzy.
- Fuzzy hanya memakai deteksi terbaru dalam 30 menit terakhir; setelahnya label visual `Normal`.
- Hasil uji 50 foto TSS2 (10 per kelas): kelas dan label benar 50/50. Belum ada uji foto tambak asli.
- Kode respons `/api/ai/analyze`: 201, 400 (tanpa `node_id`/gambar), 404 (node tak dikenal), 422 (foto ditolak), 502 (service AI mati).
