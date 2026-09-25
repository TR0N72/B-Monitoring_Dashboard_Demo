# Laporan Progres Pengembangan Proyek B-Monitor
**Tanggal:** 25 September 2026

## 1. Deskripsi Proyek (Project Overview)
**B-Monitor** adalah sistem pemantauan kualitas air tambak berbasis Internet of Things (IoT) dan Web. Sistem ini dirancang untuk membaca empat parameter utama: **Suhu, pH, Salinitas, dan Kekeruhan (Turbidity)** menggunakan *node* sensor ESP32 yang berkomunikasi via jaringan LoRa. 

Selain fungsi pemantauan (*monitoring*), B-Monitor dilengkapi dengan **Decision Support System (DSS) berbasis Logika Fuzzy** di sisi *Backend* untuk mengevaluasi kualitas air secara otomatis, memberikan peringatan dini (*alerting*) melalui Bot Telegram, dan mengaktifkan aktuator (seperti pompa air atau aerator) dalam ekosistem *closed-loop*.

## 2. Status Proyek Saat Ini (Current Status)
Saat ini, proyek berada pada fase penyelesaian **Minimum Viable Product (MVP)** dan persiapan *User Acceptance Testing* (UAT) untuk integrasi dengan perangkat keras fisik.

**Infrastruktur & Arsitektur (Sudah Berjalan 100%):**
- Sistem telah di-Dockerisasi secara penuh (*Docker Compose*).
- **Database:** MySQL berjalan stabil dengan skema tabel yang sudah menampung seluruh parameter metrik (`sensor_data`) dan pencatatan riwayat peringatan (`alert_logs`).
- **IoT Pipeline:** Eclipse Mosquitto (Broker MQTT) beroperasi sebagai pintu masuk telemetri dari ESP32.
- **Backend (Node.js/Express):** API untuk melayani *Frontend*, mengeksekusi logika Fuzzy, dan mengirim pesan Telegram sudah terhubung dengan baik ke MySQL dan MQTT.
- **Visualisasi & UI:** *Frontend* menggunakan Next.js (Dashboard Utama) dan Grafana (*iframe embedding* untuk grafik analitik).

**Kesiapan Perangkat Keras (*Hardware Readiness*):**
Telah disepakati bahwa *hardware* di lapangan akan menggunakan sumber listrik hibrida (PLN + Baterai/Panel Surya) sehingga perangkat keras menyala 24/7. Modul komunikasi LoRa akan dikonfigurasi sebagai **Class C** agar *Backend* dapat mengirimkan instruksi (menggerakkan pompa/kalibrasi sensor) secara *real-time* kapan saja.

## 3. Pencapaian Sesi Ini (Work Accomplished)
Pada iterasi *development* terakhir, beberapa perbaikan fundamental struktural dan keamanan telah diselesaikan:

1. **Sinkronisasi Data Telemetri (UI vs API):**
   Memperbaiki *bug* fatal di mana UI React gagal merender data aktual dan terkunci pada angka statis.
   - Mengubah skema database untuk mengakomodasi kolom `ph_level` dan `turbidity`.
   - Menyesuaikan *parsing* JSON dari *payload* ESP32 di `mqtt.js`.
   - Merutekan ulang komponen UI `page.js` dan menyesuaikan penamaan variabel agar Kartu Metrik dan Tabel *Historical Logs* menampilkan data presisi dari database.
2. **Keamanan Autentikasi (Penyelesaian Tech Debt B.1):**
   Mengubah mekanisme penyimpanan JWT (*JSON Web Token*) dari `localStorage` yang rentan pencurian (XSS) menjadi **HttpOnly Cookies**. Sesi pengguna sekarang diverifikasi secara aman oleh server pada setiap *request*.
3. **Otomatisasi Grafana:**
   Konfigurasi *dashboard* Grafana (`bmonitor-main` dan `bmonitor-telemetry`) kini di- *provisioning* secara otomatis saat Docker pertama kali menyala, menghilangkan kebutuhan pengaturan manual.

## 4. Rencana Pengembangan Kedepan (Future Development & Tech Debt)
Langkah selanjutnya berfokus pada penyelesaian sisa utang teknis (*Technical Debt*) agar sistem tahan uji (*production-ready*) sebelum masuk ke tahap riset *Artificial Intelligence* (AI).

### A. Prioritas Jangka Pendek (Penyelesaian Sisa Tech Debt)
- **Rate Limiting (B.2):** Membatasi jumlah percobaan *login* palsu untuk mencegah serangan *Brute Force*.
- **Validasi Payload MQTT (B.3):** Menambahkan lapisan proteksi pada aliran data MQTT untuk mencegah *backend crash* akibat data sensor yang cacat (*malformed JSON*).
- **Exponential Backoff (B.4):** Mengubah perilaku UI agar tidak membombardir *server* saat koneksi terputus.
- **Race Condition Handling (B.5):** Mencegah terkirimnya pesan notifikasi ganda ke Telegram.

### B. Prioritas Jangka Menengah (Post-MVP Features)
- Mengaktifkan fitur kontrol dua arah secara penuh (Downlink) pada UI agar pengguna dapat menekan tombol `Reboot Node` atau `Turn On Pump` dan perintah tersebut diteruskan via MQTT ke LoRa.
- Mengaktifkan fitur Paginasi, Mode Tabel UI, dan layanan pemulihan *Password* mandiri via SMTP.

### C. Riset Kecerdasan Buatan (AI Integration)
Saat ini arsitektur database sudah dibangun agar **AI-Ready** (menampung semua riwayat data mentah). Tahap selanjutnya memerlukan diskusi bersama dosen pembimbing untuk menentukan apakah model AI (*Machine Learning*) akan dilatih untuk **Prediksi** (Meramalkan kapan kualitas air akan memburuk sebelum ikan terdampak) atau murni untuk **Otomatisasi Keputusan** (Menggantikan Logika Fuzzy saat ini).
