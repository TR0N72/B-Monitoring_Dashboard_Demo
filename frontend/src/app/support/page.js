'use client';

import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

const CONTACTS = [
  {
    label: 'Pemilik / Owner',
    name: 'Bapak Hendra Santoso',
    phone: '+62 812-3456-7890',
    whatsapp: '6281234567890',
  },
  {
    label: 'Tim Teknis — Lead Engineer',
    name: 'Andi Kurniawan',
    phone: '+62 857-9876-5432',
    whatsapp: '6285798765432',
  },
  {
    label: 'Tim Teknis — Field Support',
    name: 'Rizky Pratama',
    phone: '+62 821-1122-3344',
    whatsapp: '6282111223344',
  },
];

const STEPS = [
  'Hubungi Pemilik atau Tim Teknis melalui nomor kontak yang tersedia di bawah.',
  'Sampaikan nama lengkap, lokasi tambak, dan jumlah kolam yang dimiliki.',
  'Tim akan melakukan survei lokasi untuk menentukan jumlah Sensor Node yang dibutuhkan.',
  'Setelah survei, akan dibuat perjanjian pemasangan dan biaya langganan layanan.',
  'Tim Teknis melakukan instalasi perangkat LoRa di lokasi tambak Anda.',
  'Akun B-Monitor Anda akan dibuat dan Anda akan mendapatkan panduan penggunaan aplikasi.',
  'Selamat! Tambak Anda kini terpantau secara real-time melalui B-Monitor.',
];

export default function SupportPage() {
  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content">
        <div className="main-canvas">
          <TopAppBar />
          <div className="scrollable-content">

            {/* Header */}
            <div className="page-header-controls">
              <div className="page-title-section">
                <div className="heading-1">
                  <h1>Bantuan & Dukungan</h1>
                </div>
                <div className="status-indicator">
                  <div className="status-dot" />
                  <p>Tim siap membantu Anda</p>
                </div>
              </div>
            </div>

            {/* Kontak */}
            <div className="support-section">
              <h2 className="support-section-title">Kontak Kami</h2>
              <div className="support-cards-grid">
                {CONTACTS.map((c) => (
                  <div key={c.name} className="support-contact-card">
                    <p className="support-contact-label">{c.label}</p>
                    <p className="support-contact-name">{c.name}</p>
                    <p className="support-contact-phone">{c.phone}</p>
                    <a
                      href={`https://wa.me/${c.whatsapp}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="support-wa-btn"
                    >
                      WhatsApp
                    </a>
                  </div>
                ))}
              </div>
            </div>

            {/* Langkah menjadi anggota */}
            <div className="support-section">
              <h2 className="support-section-title">Cara Menjadi Anggota</h2>
              <div className="support-steps">
                {STEPS.map((step, i) => (
                  <div key={i} className="support-step">
                    <div className="support-step-number">{i + 1}</div>
                    <p className="support-step-text">{step}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
