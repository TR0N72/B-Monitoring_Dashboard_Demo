'use strict';
/**
 * fuzzyDSS.js — Fuzzy Logic Decision Support System (Metode Mamdani)
 * ===================================================================
 * Sistem DSS untuk budidaya bandeng di tambak Juwana, Kabupaten Pati.
 *
 * Variabel Input:
 *   1. Suhu Air  (°C)   — Rendah / Normal / Tinggi
 *   2. Salinitas (ppt)  — Rendah / Normal / Tinggi
 *
 * Variabel Output:
 *   DSS Score (0–100) → Aman / Waspada / Bahaya
 *
 * Jumlah Aturan:
 *   3 (Suhu) × 3 (Salinitas) = 9 kombinasi utama
 *
 * Referensi pakar:
 *   - Suhu optimal bandeng Juwana: 28–30 °C
 *   - Salinitas optimal          : 15–25 ppt
 *   - Data SNI & Balai Besar Perikanan Budidaya Air Payau Jepara
 *
 * Metode Defuzzifikasi:
 *   Center of Gravity (CoG) — Titik pusat dari agregasi area keluaran.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. FUZZIFIKASI — Fungsi Keanggotaan Input
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fuzzifikasi Suhu Air (°C) untuk budidaya bandeng Juwana.
 *
 * Rentang:
 *   Rendah  : ≤ 26 °C  (berbahaya — pertumbuhan terhambat)
 *   Normal  : 26–32 °C (optimal pada 28–30 °C)
 *   Tinggi  : ≥ 30 °C  (berbahaya — stres termal)
 *
 * Fungsi keanggotaan: Trapezoidal-Triangular gabungan.
 *
 * @param {number} t - Nilai suhu dalam °C
 * @returns {{ rendah: number, normal: number, tinggi: number }}
 */
function fuzzySuhu(t) {
  const mu = { rendah: 0, normal: 0, tinggi: 0 };

  // Rendah: trapezoidal [−∞, 24, 26, 28]
  if (t <= 24)       mu.rendah = 1;
  else if (t <= 26)  mu.rendah = (26 - t) / (26 - 24);
  else if (t <= 28)  mu.rendah = (28 - t) / (28 - 26); // transisi menuju normal
  // (setelah 28 → 0)

  // Normal: triangular [26, 29, 32]
  if (t > 26 && t <= 29)      mu.normal = (t - 26) / (29 - 26);
  else if (t > 29 && t <= 32) mu.normal = (32 - t) / (32 - 29);

  // Tinggi: trapezoidal [30, 32, +∞]
  if (t >= 32)       mu.tinggi = 1;
  else if (t >= 30)  mu.tinggi = (t - 30) / (32 - 30);

  return mu;
}

/**
 * Fuzzifikasi Salinitas Air (ppt) untuk budidaya bandeng Juwana.
 *
 * Rentang:
 *   Rendah  : ≤ 10 ppt  (berbahaya — terlalu tawar)
 *   Normal  : 10–30 ppt (optimal pada 15–25 ppt)
 *   Tinggi  : ≥ 25 ppt  (berbahaya — terlalu asin)
 *
 * @param {number} s - Nilai salinitas dalam ppt
 * @returns {{ rendah: number, normal: number, tinggi: number }}
 */
function fuzzySalinitas(s) {
  const mu = { rendah: 0, normal: 0, tinggi: 0 };

  // Rendah: trapezoidal [−∞, 8, 12, 15]
  if (s <= 8)        mu.rendah = 1;
  else if (s <= 12)  mu.rendah = (12 - s) / (12 - 8);
  else if (s <= 15)  mu.rendah = (15 - s) / (15 - 12);

  // Normal: trapezoidal [12, 17, 22, 28]
  if (s > 12 && s <= 17)      mu.normal = (s - 12) / (17 - 12);
  else if (s > 17 && s <= 22) mu.normal = 1;
  else if (s > 22 && s <= 28) mu.normal = (28 - s) / (28 - 22);

  // Tinggi: trapezoidal [25, 28, +∞]
  if (s >= 32)       mu.tinggi = 1;
  else if (s >= 25)  mu.tinggi = (s - 25) / (32 - 25);

  return mu;
}

/**
 * Fuzzifikasi Label Visual dari XGBoost.
 *
 * Label string dikonversi menjadi nilai keanggotaan krisp (singleton fuzzy).
 * Ini memodelkan kepastian visual sebagai input fuzzy.
 *
 * @param {string} label - "Normal" | "Caution" | "Warning" (case-insensitive)
 * @returns {{ normal: number, caution: number, warning: number }}
 */
function fuzzyVisual(label) {
  const l = (label || 'Normal').toLowerCase();
  switch (l) {
    case 'normal':  return { normal: 1, caution: 0, warning: 0 };
    case 'caution': return { normal: 0, caution: 1, warning: 0 };
    case 'warning': return { normal: 0, caution: 0, warning: 1 };
    default:        return { normal: 1, caution: 0, warning: 0 }; // fallback ke Normal
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. EVALUASI 27 ATURAN IF-THEN (Mamdani)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Matriks 27 aturan inferensi Fuzzy berbasis pakar tambak bandeng Juwana.
 *
 * Format setiap aturan:
 *   { suhu, salinitas, visual, output, label, description }
 *
 * Output nilai (output area CoG representative centroid):
 *   20  → Aman    (0–35)
 *   50  → Waspada (36–65)
 *   80  → Bahaya  (66–100)
 *
 * Logika:
 *   - Kondisi Normal (suhu normal + salinitas normal + visual normal) → Aman (skor rendah)
 *   - Satu faktor keluar dari optimal → Waspada
 *   - Dua atau lebih faktor bermasalah, atau visual Warning → Bahaya
 *   - Visual Warning selalu meningkatkan level satu tingkat di atas prediksi fisik
 *
 * @param {{ rendah, normal, tinggi }} suhuMu
 * @param {{ rendah, normal, tinggi }} salinitasMu
 * @param {{ normal, caution, warning }} visualMu
 * @returns {Array<{weight, output, label, rule_id, description}>}
 */
function evaluateRules(suhuMu, salinitasMu, visualMu) {
  const rules = [
    // ─── Blok 1: Suhu RENDAH × Salinitas × Visual ─────────────────────────
    // R01: Suhu Rendah, Salinitas Rendah, Visual Normal → Bahaya
    //      Dua parameter fisik buruk, meski air tampak jernih
    {
      rule_id     : 'R01',
      weight      : Math.min(suhuMu.rendah, salinitasMu.rendah, visualMu.normal),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Rendah & Salinitas Rendah → Bahaya (fisik kritis)',
    },
    // R02: Suhu Rendah, Salinitas Rendah, Visual Caution → Bahaya
    {
      rule_id     : 'R02',
      weight      : Math.min(suhuMu.rendah, salinitasMu.rendah, visualMu.caution),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Rendah & Salinitas Rendah & Air Keruh → Bahaya',
    },
    // R03: Suhu Rendah, Salinitas Rendah, Visual Warning → Bahaya (kritis)
    {
      rule_id     : 'R03',
      weight      : Math.min(suhuMu.rendah, salinitasMu.rendah, visualMu.warning),
      output      : 95,
      label       : 'Bahaya',
      description : 'Semua parameter buruk → Bahaya Kritis',
    },

    // R04: Suhu Rendah, Salinitas Normal, Visual Normal → Waspada
    //      Suhu dingin adalah satu-satunya masalah, air masih jernih
    {
      rule_id     : 'R04',
      weight      : Math.min(suhuMu.rendah, salinitasMu.normal, visualMu.normal),
      output      : 50,
      label       : 'Waspada',
      description : 'Suhu Rendah, Salinitas Normal, Air Jernih → Waspada',
    },
    // R05: Suhu Rendah, Salinitas Normal, Visual Caution → Waspada (lebih berat)
    {
      rule_id     : 'R05',
      weight      : Math.min(suhuMu.rendah, salinitasMu.normal, visualMu.caution),
      output      : 65,
      label       : 'Waspada',
      description : 'Suhu Rendah & Air Mulai Keruh → Waspada Tinggi',
    },
    // R06: Suhu Rendah, Salinitas Normal, Visual Warning → Bahaya
    //      Suhu rendah + kondisi visual buruk → risiko tinggi
    {
      rule_id     : 'R06',
      weight      : Math.min(suhuMu.rendah, salinitasMu.normal, visualMu.warning),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Rendah & Air Sangat Keruh → Bahaya',
    },

    // R07: Suhu Rendah, Salinitas Tinggi, Visual Normal → Bahaya
    //      Dua parameter fisik buruk
    {
      rule_id     : 'R07',
      weight      : Math.min(suhuMu.rendah, salinitasMu.tinggi, visualMu.normal),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Rendah & Salinitas Tinggi → Bahaya',
    },
    // R08: Suhu Rendah, Salinitas Tinggi, Visual Caution → Bahaya
    {
      rule_id     : 'R08',
      weight      : Math.min(suhuMu.rendah, salinitasMu.tinggi, visualMu.caution),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Rendah & Salinitas Tinggi & Air Keruh → Bahaya',
    },
    // R09: Suhu Rendah, Salinitas Tinggi, Visual Warning → Bahaya Kritis
    {
      rule_id     : 'R09',
      weight      : Math.min(suhuMu.rendah, salinitasMu.tinggi, visualMu.warning),
      output      : 95,
      label       : 'Bahaya',
      description : 'Semua parameter buruk (suhu rendah side) → Bahaya Kritis',
    },

    // ─── Blok 2: Suhu NORMAL × Salinitas × Visual ─────────────────────────
    // R10: Suhu Normal, Salinitas Rendah, Visual Normal → Waspada
    //      Hanya salinitas yang bermasalah
    {
      rule_id     : 'R10',
      weight      : Math.min(suhuMu.normal, salinitasMu.rendah, visualMu.normal),
      output      : 50,
      label       : 'Waspada',
      description : 'Salinitas Rendah, Suhu & Visual OK → Waspada',
    },
    // R11: Suhu Normal, Salinitas Rendah, Visual Caution → Waspada
    {
      rule_id     : 'R11',
      weight      : Math.min(suhuMu.normal, salinitasMu.rendah, visualMu.caution),
      output      : 65,
      label       : 'Waspada',
      description : 'Salinitas Rendah & Air Mulai Keruh → Waspada Tinggi',
    },
    // R12: Suhu Normal, Salinitas Rendah, Visual Warning → Bahaya
    //      Salinitas rendah + visual buruk mendorong ke bahaya
    {
      rule_id     : 'R12',
      weight      : Math.min(suhuMu.normal, salinitasMu.rendah, visualMu.warning),
      output      : 80,
      label       : 'Bahaya',
      description : 'Salinitas Rendah & Air Sangat Keruh → Bahaya',
    },

    // R13: Suhu Normal, Salinitas Normal, Visual Normal → AMAN (kondisi ideal)
    {
      rule_id     : 'R13',
      weight      : Math.min(suhuMu.normal, salinitasMu.normal, visualMu.normal),
      output      : 20,
      label       : 'Aman',
      description : 'Semua parameter optimal → Aman',
    },
    // R14: Suhu Normal, Salinitas Normal, Visual Caution → Waspada
    //      Parameter fisik bagus tapi ada indikasi visual keruh
    {
      rule_id     : 'R14',
      weight      : Math.min(suhuMu.normal, salinitasMu.normal, visualMu.caution),
      output      : 50,
      label       : 'Waspada',
      description : 'Fisik Optimal, Air Mulai Keruh → Waspada',
    },
    // R15: Suhu Normal, Salinitas Normal, Visual Warning → Waspada Tinggi
    //      Fisik OK tapi kondisi visual sangat buruk — kemungkinan bloom alga
    {
      rule_id     : 'R15',
      weight      : Math.min(suhuMu.normal, salinitasMu.normal, visualMu.warning),
      output      : 65,
      label       : 'Waspada',
      description : 'Fisik Optimal, Air Sangat Keruh (Bloom?) → Waspada Tinggi',
    },

    // R16: Suhu Normal, Salinitas Tinggi, Visual Normal → Waspada
    {
      rule_id     : 'R16',
      weight      : Math.min(suhuMu.normal, salinitasMu.tinggi, visualMu.normal),
      output      : 50,
      label       : 'Waspada',
      description : 'Salinitas Tinggi, Suhu & Visual OK → Waspada',
    },
    // R17: Suhu Normal, Salinitas Tinggi, Visual Caution → Waspada
    {
      rule_id     : 'R17',
      weight      : Math.min(suhuMu.normal, salinitasMu.tinggi, visualMu.caution),
      output      : 65,
      label       : 'Waspada',
      description : 'Salinitas Tinggi & Air Mulai Keruh → Waspada Tinggi',
    },
    // R18: Suhu Normal, Salinitas Tinggi, Visual Warning → Bahaya
    {
      rule_id     : 'R18',
      weight      : Math.min(suhuMu.normal, salinitasMu.tinggi, visualMu.warning),
      output      : 80,
      label       : 'Bahaya',
      description : 'Salinitas Tinggi & Air Sangat Keruh → Bahaya',
    },

    // ─── Blok 3: Suhu TINGGI × Salinitas × Visual ─────────────────────────
    // R19: Suhu Tinggi, Salinitas Rendah, Visual Normal → Bahaya
    //      Dua parameter fisik bermasalah
    {
      rule_id     : 'R19',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.rendah, visualMu.normal),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Tinggi & Salinitas Rendah → Bahaya',
    },
    // R20: Suhu Tinggi, Salinitas Rendah, Visual Caution → Bahaya
    {
      rule_id     : 'R20',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.rendah, visualMu.caution),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Tinggi & Salinitas Rendah & Air Keruh → Bahaya',
    },
    // R21: Suhu Tinggi, Salinitas Rendah, Visual Warning → Bahaya Kritis
    {
      rule_id     : 'R21',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.rendah, visualMu.warning),
      output      : 95,
      label       : 'Bahaya',
      description : 'Semua parameter buruk (suhu tinggi side) → Bahaya Kritis',
    },

    // R22: Suhu Tinggi, Salinitas Normal, Visual Normal → Waspada
    //      Suhu panas tapi salinitas dan visual masih OK
    {
      rule_id     : 'R22',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.normal, visualMu.normal),
      output      : 50,
      label       : 'Waspada',
      description : 'Suhu Tinggi, Salinitas & Visual OK → Waspada',
    },
    // R23: Suhu Tinggi, Salinitas Normal, Visual Caution → Waspada Tinggi
    {
      rule_id     : 'R23',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.normal, visualMu.caution),
      output      : 65,
      label       : 'Waspada',
      description : 'Suhu Tinggi & Air Mulai Keruh → Waspada Tinggi',
    },
    // R24: Suhu Tinggi, Salinitas Normal, Visual Warning → Bahaya
    //      Suhu panas + visual buruk mendorong ke bahaya
    {
      rule_id     : 'R24',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.normal, visualMu.warning),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Tinggi & Air Sangat Keruh → Bahaya',
    },

    // R25: Suhu Tinggi, Salinitas Tinggi, Visual Normal → Bahaya
    //      Dua parameter fisik bermasalah dari sisi tinggi
    {
      rule_id     : 'R25',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.tinggi, visualMu.normal),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Tinggi & Salinitas Tinggi → Bahaya',
    },
    // R26: Suhu Tinggi, Salinitas Tinggi, Visual Caution → Bahaya
    {
      rule_id     : 'R26',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.tinggi, visualMu.caution),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Tinggi & Salinitas Tinggi & Air Keruh → Bahaya',
    },
    // R27: Suhu Tinggi, Salinitas Tinggi, Visual Warning → Bahaya Kritis
    {
      rule_id     : 'R27',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.tinggi, visualMu.warning),
      output      : 95,
      label       : 'Bahaya',
      description : 'Kondisi Ekstrem di Semua Faktor → Bahaya Kritis',
    },
  ];

  return rules;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. DEFUZZIFIKASI — Center of Gravity (CoG)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Hitung nilai crisp DSS Score menggunakan metode Center of Gravity.
 * CoG = Σ(μᵢ × cᵢ) / Σ(μᵢ)
 * di mana μᵢ = bobot aturan, cᵢ = nilai output representatif aturan.
 *
 * @param {Array} activeRules - Array aturan dengan weight > 0
 * @returns {number} DSS Score dalam rentang [0, 100]
 */
function defuzzify(activeRules) {
  let numerator   = 0;
  let denominator = 0;

  for (const rule of activeRules) {
    if (rule.weight > 0) {
      numerator   += rule.weight * rule.output;
      denominator += rule.weight;
    }
  }

  if (denominator === 0) return 0;
  return Math.min(100, Math.max(0, numerator / denominator));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. KLASIFIKASI OUTPUT
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Konversi DSS Score crisp ke rekomendasi linguistik.
 *
 * Skala:
 *   0  – 35 → Aman    (kondisi optimal, tidak perlu intervensi)
 *   36 – 65 → Waspada (pemantauan ketat, pertimbangkan tindakan pencegahan)
 *   66 – 100→ Bahaya  (tindakan segera diperlukan, aktifkan protokol darurat)
 *
 * @param {number} score
 * @returns {string}
 */
function getRecommendation(score) {
  if (score <= 35) return 'Aman';
  if (score <= 65) return 'Waspada';
  return 'Bahaya';
}

/**
 * Temukan anggota dengan nilai keanggotaan tertinggi (dominant membership).
 * @param {{ [key: string]: number }} memberships
 * @returns {string}
 */
function getDominantMembership(memberships) {
  let dominant = '';
  let maxVal   = -1;
  for (const [key, val] of Object.entries(memberships)) {
    if (val > maxVal) {
      maxVal   = val;
      dominant = key;
    }
  }
  return dominant;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PUBLIC API — Fungsi Utama
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Jalankan pipeline DSS Fuzzy Mamdani lengkap.
 *
 * @param {number} suhuValue      - Suhu air dalam °C
 * @param {number} salinitasValue - Salinitas dalam ppt
 *
 * @returns {{
 *   suhu_membership    : string,
 *   salinitas_membership: string,
 *   visual_label       : string,
 *   score              : number,
 *   recommendation     : string,
 *   fired_rules        : Array<{rule_id, weight, output_label, description}>
 * }}
 */
function processFuzzy(suhuValue, salinitasValue, visualLabel = 'Normal') {
  // 1. Fuzzifikasi input
  const suhuMu      = fuzzySuhu(suhuValue);
  const salinitasMu = fuzzySalinitas(salinitasValue);
  const visualMu    = fuzzyVisual(visualLabel);

  // 2. Evaluasi 27 aturan
  const rules       = evaluateRules(suhuMu, salinitasMu, visualMu);

  // 3. Defuzzifikasi CoG
  const score       = defuzzify(rules);
  const recommendation = getRecommendation(score);

  // 4. Kumpulkan aturan aktif (weight > 0) untuk transparansi / logging
  const firedRules  = rules
    .filter(r => r.weight > 0)
    .map(r => ({
      rule_id     : r.rule_id,
      weight      : parseFloat(r.weight.toFixed(4)),
      output_label: r.label,
      description : r.description,
    }));

  return {
    suhu_membership     : getDominantMembership(suhuMu),
    salinitas_membership: getDominantMembership(salinitasMu),
    visual_label        : visualLabel || 'Normal',
    score               : parseFloat(score.toFixed(2)),
    recommendation,
    fired_rules         : firedRules,
  };
}

/**
 * Ambil semua 27 definisi aturan untuk keperluan UI konfigurasi.
 * Dipanggil oleh endpoint /api/dss/rules.
 *
 * @returns {Array<{rule_id, suhu, salinitas, visual, output, label, description}>}
 */
function getRuleDefinitions() {
  return [
    { rule_id: 'R01', suhu: 'Rendah', salinitas: 'Rendah', visual: 'Normal',  output: 80, label: 'Bahaya',  description: 'Suhu Rendah & Salinitas Rendah → Bahaya (fisik kritis)' },
    { rule_id: 'R02', suhu: 'Rendah', salinitas: 'Rendah', visual: 'Caution', output: 80, label: 'Bahaya',  description: 'Suhu Rendah & Salinitas Rendah & Air Keruh → Bahaya' },
    { rule_id: 'R03', suhu: 'Rendah', salinitas: 'Rendah', visual: 'Warning', output: 95, label: 'Bahaya',  description: 'Semua parameter buruk → Bahaya Kritis' },
    { rule_id: 'R04', suhu: 'Rendah', salinitas: 'Normal', visual: 'Normal',  output: 50, label: 'Waspada', description: 'Suhu Rendah, Salinitas Normal, Air Jernih → Waspada' },
    { rule_id: 'R05', suhu: 'Rendah', salinitas: 'Normal', visual: 'Caution', output: 65, label: 'Waspada', description: 'Suhu Rendah & Air Mulai Keruh → Waspada Tinggi' },
    { rule_id: 'R06', suhu: 'Rendah', salinitas: 'Normal', visual: 'Warning', output: 80, label: 'Bahaya',  description: 'Suhu Rendah & Air Sangat Keruh → Bahaya' },
    { rule_id: 'R07', suhu: 'Rendah', salinitas: 'Tinggi', visual: 'Normal',  output: 80, label: 'Bahaya',  description: 'Suhu Rendah & Salinitas Tinggi → Bahaya' },
    { rule_id: 'R08', suhu: 'Rendah', salinitas: 'Tinggi', visual: 'Caution', output: 80, label: 'Bahaya',  description: 'Suhu Rendah & Salinitas Tinggi & Air Keruh → Bahaya' },
    { rule_id: 'R09', suhu: 'Rendah', salinitas: 'Tinggi', visual: 'Warning', output: 95, label: 'Bahaya',  description: 'Semua parameter buruk (suhu rendah side) → Bahaya Kritis' },
    { rule_id: 'R10', suhu: 'Normal', salinitas: 'Rendah', visual: 'Normal',  output: 50, label: 'Waspada', description: 'Salinitas Rendah, Suhu & Visual OK → Waspada' },
    { rule_id: 'R11', suhu: 'Normal', salinitas: 'Rendah', visual: 'Caution', output: 65, label: 'Waspada', description: 'Salinitas Rendah & Air Mulai Keruh → Waspada Tinggi' },
    { rule_id: 'R12', suhu: 'Normal', salinitas: 'Rendah', visual: 'Warning', output: 80, label: 'Bahaya',  description: 'Salinitas Rendah & Air Sangat Keruh → Bahaya' },
    { rule_id: 'R13', suhu: 'Normal', salinitas: 'Normal', visual: 'Normal',  output: 20, label: 'Aman',    description: 'Semua parameter optimal → Aman' },
    { rule_id: 'R14', suhu: 'Normal', salinitas: 'Normal', visual: 'Caution', output: 50, label: 'Waspada', description: 'Fisik Optimal, Air Mulai Keruh → Waspada' },
    { rule_id: 'R15', suhu: 'Normal', salinitas: 'Normal', visual: 'Warning', output: 65, label: 'Waspada', description: 'Fisik Optimal, Air Sangat Keruh (Bloom?) → Waspada Tinggi' },
    { rule_id: 'R16', suhu: 'Normal', salinitas: 'Tinggi', visual: 'Normal',  output: 50, label: 'Waspada', description: 'Salinitas Tinggi, Suhu & Visual OK → Waspada' },
    { rule_id: 'R17', suhu: 'Normal', salinitas: 'Tinggi', visual: 'Caution', output: 65, label: 'Waspada', description: 'Salinitas Tinggi & Air Mulai Keruh → Waspada Tinggi' },
    { rule_id: 'R18', suhu: 'Normal', salinitas: 'Tinggi', visual: 'Warning', output: 80, label: 'Bahaya',  description: 'Salinitas Tinggi & Air Sangat Keruh → Bahaya' },
    { rule_id: 'R19', suhu: 'Tinggi', salinitas: 'Rendah', visual: 'Normal',  output: 80, label: 'Bahaya',  description: 'Suhu Tinggi & Salinitas Rendah → Bahaya' },
    { rule_id: 'R20', suhu: 'Tinggi', salinitas: 'Rendah', visual: 'Caution', output: 80, label: 'Bahaya',  description: 'Suhu Tinggi & Salinitas Rendah & Air Keruh → Bahaya' },
    { rule_id: 'R21', suhu: 'Tinggi', salinitas: 'Rendah', visual: 'Warning', output: 95, label: 'Bahaya',  description: 'Semua parameter buruk (suhu tinggi side) → Bahaya Kritis' },
    { rule_id: 'R22', suhu: 'Tinggi', salinitas: 'Normal', visual: 'Normal',  output: 50, label: 'Waspada', description: 'Suhu Tinggi, Salinitas & Visual OK → Waspada' },
    { rule_id: 'R23', suhu: 'Tinggi', salinitas: 'Normal', visual: 'Caution', output: 65, label: 'Waspada', description: 'Suhu Tinggi & Air Mulai Keruh → Waspada Tinggi' },
    { rule_id: 'R24', suhu: 'Tinggi', salinitas: 'Normal', visual: 'Warning', output: 80, label: 'Bahaya',  description: 'Suhu Tinggi & Air Sangat Keruh → Bahaya' },
    { rule_id: 'R25', suhu: 'Tinggi', salinitas: 'Tinggi', visual: 'Normal',  output: 80, label: 'Bahaya',  description: 'Suhu Tinggi & Salinitas Tinggi → Bahaya' },
    { rule_id: 'R26', suhu: 'Tinggi', salinitas: 'Tinggi', visual: 'Caution', output: 80, label: 'Bahaya',  description: 'Suhu Tinggi & Salinitas Tinggi & Air Keruh → Bahaya' },
    { rule_id: 'R27', suhu: 'Tinggi', salinitas: 'Tinggi', visual: 'Warning', output: 95, label: 'Bahaya',  description: 'Kondisi Ekstrem di Semua Faktor → Bahaya Kritis' },
  ];
}

module.exports = {
  processFuzzy,
  getRuleDefinitions,
  // Export fungsi internal untuk keperluan unit testing
  fuzzySuhu,
  fuzzySalinitas,
  fuzzyVisual,
  defuzzify,
  getRecommendation,
};
