'use strict';
/**
 * Unit Testing — Fuzzy DSS (fuzzyDSS.js)
 * ========================================
 * Menguji setiap lapisan sistem Fuzzy Mamdani secara terpisah:
 *
 *  Layer 1: Fuzzifikasi Suhu       — fuzzySuhu()
 *  Layer 2: Fuzzifikasi Salinitas  — fuzzySalinitas()
 *  Layer 3: Fuzzifikasi Visual     — fuzzyVisual()
 *  Layer 4: Defuzzifikasi CoG      — defuzzify()
 *  Layer 5: Klasifikasi Output     — getRecommendation()
 *  Layer 6: Integrasi Penuh        — processFuzzy()  ← skenario nyata tambak
 *  Layer 7: Edge Cases             — nilai batas, NaN, undefined
 */

const {
  fuzzySuhu,
  fuzzySalinitas,
  fuzzyVisual,
  defuzzify,
  getRecommendation,
  processFuzzy,
  getRuleDefinitions,
} = require('../services/fuzzyDSS');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: bulatkan ke 4 desimal untuk perbandingan float
// ─────────────────────────────────────────────────────────────────────────────
const r4 = (n) => parseFloat(n.toFixed(4));

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: fuzzySuhu — Fungsi Keanggotaan Suhu
// ─────────────────────────────────────────────────────────────────────────────
describe('🌡️ fuzzySuhu() — Membership Function', () => {
  // ── Titik ekstrem bawah ──────────────────────────────────────────────────
  test('t = 10°C → rendah = 1, normal = 0, tinggi = 0', () => {
    const mu = fuzzySuhu(10);
    expect(mu.rendah).toBe(1);
    expect(mu.normal).toBe(0);
    expect(mu.tinggi).toBe(0);
  });

  test('t = 24°C → rendah = 1 (tepat di batas plateau rendah)', () => {
    const mu = fuzzySuhu(24);
    expect(mu.rendah).toBe(1);
    expect(mu.normal).toBe(0);
    expect(mu.tinggi).toBe(0);
  });

  // ── Zona transisi rendah→normal ──────────────────────────────────────────
  test('t = 25°C → rendah mengecil (0.5 di tengah transisi 24–26)', () => {
    const mu = fuzzySuhu(25);
    expect(r4(mu.rendah)).toBe(0.5);  // (26-25)/(26-24) = 0.5
    expect(mu.normal).toBe(0);
    expect(mu.tinggi).toBe(0);
  });

  test('t = 27°C → rendah mulai ke 0, normal mulai naik', () => {
    const mu = fuzzySuhu(27);
    expect(r4(mu.rendah)).toBe(0.5);  // (28-27)/(28-26) = 0.5
    expect(r4(mu.normal)).toBe(r4((27 - 26) / (29 - 26)));
  });

  // ── Zona normal ──────────────────────────────────────────────────────────
  test('t = 29°C → normal = 1 (puncak triangular)', () => {
    const mu = fuzzySuhu(29);
    expect(mu.normal).toBe(1);
    expect(mu.rendah).toBe(0);
    expect(mu.tinggi).toBe(0);
  });

  test('t = 28°C → normal tepat 2/3 naik ke puncak', () => {
    // (28-26)/(29-26) = 2/3 ≈ 0.6667
    const mu = fuzzySuhu(28);
    expect(r4(mu.normal)).toBe(r4(2 / 3));
    expect(mu.rendah).toBe(0);
  });

  test('t = 30°C → normal mulai turun dari puncak + tinggi mulai naik', () => {
    const mu = fuzzySuhu(30);
    expect(r4(mu.normal)).toBe(r4((32 - 30) / (32 - 29)));  // 2/3
    expect(r4(mu.tinggi)).toBe(0);  // (30-30)/(32-30) = 0, baru mulai
  });

  test('t = 31°C → normal turun, tinggi = 0.5', () => {
    const mu = fuzzySuhu(31);
    expect(r4(mu.normal)).toBe(r4((32 - 31) / (32 - 29)));  // 1/3
    expect(r4(mu.tinggi)).toBe(0.5);  // (31-30)/(32-30) = 0.5
  });

  // ── Titik ekstrem atas ───────────────────────────────────────────────────
  test('t = 32°C → tinggi = 1, normal = 0', () => {
    const mu = fuzzySuhu(32);
    expect(mu.tinggi).toBe(1);
    expect(mu.normal).toBe(0);
  });

  test('t = 40°C → tinggi = 1 (di atas plateau)', () => {
    const mu = fuzzySuhu(40);
    expect(mu.tinggi).toBe(1);
    expect(mu.rendah).toBe(0);
    expect(mu.normal).toBe(0);
  });

  // ── Properti umum ─────────────────────────────────────────────────────────
  test('Semua nilai membership harus antara 0 dan 1', () => {
    const temps = [10, 20, 24, 25, 26, 27, 28, 29, 30, 31, 32, 35, 40];
    temps.forEach((t) => {
      const mu = fuzzySuhu(t);
      expect(mu.rendah).toBeGreaterThanOrEqual(0);
      expect(mu.rendah).toBeLessThanOrEqual(1);
      expect(mu.normal).toBeGreaterThanOrEqual(0);
      expect(mu.normal).toBeLessThanOrEqual(1);
      expect(mu.tinggi).toBeGreaterThanOrEqual(0);
      expect(mu.tinggi).toBeLessThanOrEqual(1);
    });
  });

  test('Mengembalikan objek dengan kunci rendah, normal, tinggi', () => {
    const mu = fuzzySuhu(29);
    expect(mu).toHaveProperty('rendah');
    expect(mu).toHaveProperty('normal');
    expect(mu).toHaveProperty('tinggi');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: fuzzySalinitas — Fungsi Keanggotaan Salinitas
// ─────────────────────────────────────────────────────────────────────────────
describe('🧂 fuzzySalinitas() — Membership Function', () => {
  // ── Titik ekstrem bawah ──────────────────────────────────────────────────
  test('s = 5 ppt → rendah = 1 (di bawah plateau)', () => {
    const mu = fuzzySalinitas(5);
    expect(mu.rendah).toBe(1);
    expect(mu.normal).toBe(0);
    expect(mu.tinggi).toBe(0);
  });

  test('s = 8 ppt → rendah = 1 (tepat di batas plateau)', () => {
    const mu = fuzzySalinitas(8);
    expect(mu.rendah).toBe(1);
  });

  test('s = 10 ppt → rendah = 0.5 (tengah transisi 8–12)', () => {
    const mu = fuzzySalinitas(10);
    expect(r4(mu.rendah)).toBe(0.5);  // (12-10)/(12-8) = 0.5
  });

  // ── Zona normal (trapezoidal plateau 17–22) ──────────────────────────────
  test('s = 17 ppt → normal = 1 (masuk plateau)', () => {
    const mu = fuzzySalinitas(17);
    expect(mu.normal).toBe(1);
  });

  test('s = 20 ppt → normal = 1 (tengah plateau optimal)', () => {
    const mu = fuzzySalinitas(20);
    expect(mu.normal).toBe(1);
    expect(mu.rendah).toBe(0);
    expect(mu.tinggi).toBe(0);
  });

  test('s = 22 ppt → normal = 1 (ujung plateau)', () => {
    const mu = fuzzySalinitas(22);
    expect(mu.normal).toBe(1);
  });

  test('s = 25 ppt → normal turun, tinggi mulai naik', () => {
    const mu = fuzzySalinitas(25);
    // normal: (28-25)/(28-22) = 3/6 = 0.5
    expect(r4(mu.normal)).toBe(0.5);
    // tinggi: (25-25)/(32-25) = 0
    expect(mu.tinggi).toBe(0);
  });

  // ── Zona tinggi ─────────────────────────────────────────────────────────
  test('s = 28.5 ppt → normal = 0 (di atas 28), tinggi muncul', () => {
    const mu = fuzzySalinitas(28.5);
    expect(mu.normal).toBe(0);
    expect(r4(mu.tinggi)).toBe(r4((28.5 - 25) / (32 - 25)));
  });

  test('s = 32 ppt → tinggi = 1', () => {
    const mu = fuzzySalinitas(32);
    expect(mu.tinggi).toBe(1);
  });

  test('s = 40 ppt → tinggi = 1 (jauh di atas)', () => {
    const mu = fuzzySalinitas(40);
    expect(mu.tinggi).toBe(1);
    expect(mu.rendah).toBe(0);
    expect(mu.normal).toBe(0);
  });

  // ── Properti umum ─────────────────────────────────────────────────────────
  test('Semua nilai membership antara 0 dan 1 di berbagai salinitas', () => {
    [0, 5, 8, 10, 12, 15, 17, 20, 22, 25, 28, 32, 40].forEach((s) => {
      const mu = fuzzySalinitas(s);
      ['rendah', 'normal', 'tinggi'].forEach((k) => {
        expect(mu[k]).toBeGreaterThanOrEqual(0);
        expect(mu[k]).toBeLessThanOrEqual(1);
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3: fuzzyVisual — Fungsi Keanggotaan Label Visual
// ─────────────────────────────────────────────────────────────────────────────
describe('👁️ fuzzyVisual() — Label Membership', () => {
  test('"Normal" → { normal: 1, caution: 0, warning: 0 }', () => {
    const mu = fuzzyVisual('Normal');
    expect(mu).toEqual({ normal: 1, caution: 0, warning: 0 });
  });

  test('"Caution" → { normal: 0, caution: 1, warning: 0 }', () => {
    const mu = fuzzyVisual('Caution');
    expect(mu).toEqual({ normal: 0, caution: 1, warning: 0 });
  });

  test('"Warning" → { normal: 0, caution: 0, warning: 1 }', () => {
    const mu = fuzzyVisual('Warning');
    expect(mu).toEqual({ normal: 0, caution: 0, warning: 1 });
  });

  test('Case insensitive — "NORMAL" sama dengan "Normal"', () => {
    expect(fuzzyVisual('NORMAL')).toEqual(fuzzyVisual('Normal'));
  });

  test('Case insensitive — "caution" (lowercase)', () => {
    expect(fuzzyVisual('caution')).toEqual({ normal: 0, caution: 1, warning: 0 });
  });

  test('Label tidak dikenal → fallback ke Normal', () => {
    expect(fuzzyVisual('unknown_label')).toEqual({ normal: 1, caution: 0, warning: 0 });
  });

  test('null atau undefined → fallback ke Normal', () => {
    expect(fuzzyVisual(null)).toEqual({ normal: 1, caution: 0, warning: 0 });
    expect(fuzzyVisual(undefined)).toEqual({ normal: 1, caution: 0, warning: 0 });
  });

  test('String kosong "" → fallback ke Normal', () => {
    expect(fuzzyVisual('')).toEqual({ normal: 1, caution: 0, warning: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4: defuzzify — Center of Gravity
// ─────────────────────────────────────────────────────────────────────────────
describe('⚖️ defuzzify() — Center of Gravity', () => {
  test('Satu aturan aktif dengan weight 1 → output = nilai aturan itu', () => {
    const rules = [{ weight: 1, output: 20 }, { weight: 0, output: 80 }];
    expect(defuzzify(rules)).toBe(20);
  });

  test('Dua aturan weight sama → output = rata-rata', () => {
    const rules = [
      { weight: 0.5, output: 20 },
      { weight: 0.5, output: 80 },
    ];
    expect(defuzzify(rules)).toBe(50);
  });

  test('Semua weight = 0 → output = 0 (denominator protection)', () => {
    const rules = [
      { weight: 0, output: 20 },
      { weight: 0, output: 80 },
    ];
    expect(defuzzify(rules)).toBe(0);
  });

  test('Tidak ada aturan aktif (array kosong) → output = 0', () => {
    expect(defuzzify([])).toBe(0);
  });

  test('CoG formula: Σ(μ·c) / Σ(μ) — verifikasi manual', () => {
    const rules = [
      { weight: 0.8, output: 20 },   // 0.8 × 20 = 16
      { weight: 0.6, output: 50 },   // 0.6 × 50 = 30
      { weight: 0.3, output: 80 },   // 0.3 × 80 = 24
    ];
    // Σ numerator = 16 + 30 + 24 = 70
    // Σ denominator = 0.8 + 0.6 + 0.3 = 1.7
    // CoG = 70 / 1.7 ≈ 41.1765
    const expected = 70 / 1.7;
    expect(r4(defuzzify(rules))).toBe(r4(expected));
  });

  test('Output tidak boleh melebihi 100', () => {
    const rules = [{ weight: 1, output: 150 }];
    expect(defuzzify(rules)).toBe(100);
  });

  test('Output tidak boleh di bawah 0', () => {
    const rules = [{ weight: 1, output: -50 }];
    expect(defuzzify(rules)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5: getRecommendation — Klasifikasi Linguistik
// ─────────────────────────────────────────────────────────────────────────────
describe('📋 getRecommendation() — Score Classification', () => {
  test('score 0 → Aman', () => expect(getRecommendation(0)).toBe('Aman'));
  test('score 20 → Aman', () => expect(getRecommendation(20)).toBe('Aman'));
  test('score 35 → Aman (batas atas)', () => expect(getRecommendation(35)).toBe('Aman'));

  test('score 36 → Waspada (batas bawah)', () => expect(getRecommendation(36)).toBe('Waspada'));
  test('score 50 → Waspada', () => expect(getRecommendation(50)).toBe('Waspada'));
  test('score 65 → Waspada (batas atas)', () => expect(getRecommendation(65)).toBe('Waspada'));

  test('score 66 → Bahaya (batas bawah)', () => expect(getRecommendation(66)).toBe('Bahaya'));
  test('score 80 → Bahaya', () => expect(getRecommendation(80)).toBe('Bahaya'));
  test('score 100 → Bahaya', () => expect(getRecommendation(100)).toBe('Bahaya'));
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6: processFuzzy — Skenario Nyata Tambak Bandeng Juwana
// ─────────────────────────────────────────────────────────────────────────────
describe('🐟 processFuzzy() — Skenario Nyata Tambak Juwana', () => {
  // ── Kondisi Ideal ────────────────────────────────────────────────────────
  describe('Kondisi Ideal', () => {
    test('Suhu 29°C, Salinitas 20ppt, Visual Normal → Aman', () => {
      const result = processFuzzy(29, 20, 'Normal');
      expect(result.recommendation).toBe('Aman');
      expect(result.score).toBeLessThanOrEqual(35);
      expect(result.suhu_membership).toBe('normal');
      expect(result.salinitas_membership).toBe('normal');
      expect(result.visual_label).toBe('Normal');
    });

    test('Kondisi ideal harus mengaktifkan R13 (Aman)', () => {
      const result = processFuzzy(29, 20, 'Normal');
      const r13 = result.fired_rules.find(r => r.rule_id === 'R13');
      expect(r13).toBeDefined();
      expect(r13.weight).toBeGreaterThan(0);
      expect(r13.output_label).toBe('Aman');
    });
  });

  // ── Kondisi Suhu Terlalu Rendah ──────────────────────────────────────────
  describe('Suhu Rendah', () => {
    test('Suhu 20°C, Salinitas 20ppt, Visual Normal → Bahaya/Waspada', () => {
      const result = processFuzzy(20, 20, 'Normal');
      // Suhu sangat rendah → setidaknya Waspada
      expect(['Waspada', 'Bahaya']).toContain(result.recommendation);
      expect(result.suhu_membership).toBe('rendah');
    });

    test('Suhu 20°C, Salinitas 5ppt (keduanya rendah) → Bahaya', () => {
      const result = processFuzzy(20, 5, 'Normal');
      expect(result.recommendation).toBe('Bahaya');
      expect(result.score).toBeGreaterThan(65);
    });

    test('Suhu rendah mengaktifkan aturan R01-R09', () => {
      const result = processFuzzy(20, 20, 'Normal');
      const rendahRules = result.fired_rules.filter(r =>
        ['R01','R02','R03','R04','R05','R06','R07','R08','R09'].includes(r.rule_id)
      );
      expect(rendahRules.length).toBeGreaterThan(0);
    });
  });

  // ── Kondisi Suhu Terlalu Tinggi ──────────────────────────────────────────
  describe('Suhu Tinggi', () => {
    test('Suhu 35°C, Salinitas 20ppt, Visual Normal → Waspada atau Bahaya', () => {
      const result = processFuzzy(35, 20, 'Normal');
      expect(['Waspada', 'Bahaya']).toContain(result.recommendation);
      expect(result.suhu_membership).toBe('tinggi');
    });

    test('Suhu 35°C, Salinitas 40ppt (keduanya tinggi) → Bahaya', () => {
      const result = processFuzzy(35, 40, 'Normal');
      expect(result.recommendation).toBe('Bahaya');
      expect(result.score).toBeGreaterThan(65);
    });
  });

  // ── Kondisi Salinitas Bermasalah ─────────────────────────────────────────
  describe('Salinitas Bermasalah', () => {
    test('Salinitas 5ppt (terlalu tawar), suhu normal → Waspada/Bahaya', () => {
      const result = processFuzzy(29, 5, 'Normal');
      expect(['Waspada', 'Bahaya']).toContain(result.recommendation);
      expect(result.salinitas_membership).toBe('rendah');
    });

    test('Salinitas 40ppt (terlalu asin), suhu normal → Waspada/Bahaya', () => {
      const result = processFuzzy(29, 40, 'Normal');
      expect(['Waspada', 'Bahaya']).toContain(result.recommendation);
      expect(result.salinitas_membership).toBe('tinggi');
    });
  });

  // ── Efek Visual Label ────────────────────────────────────────────────────
  describe('Pengaruh Visual Label', () => {
    test('Kondisi fisik ideal + Visual Warning → minimal Waspada', () => {
      const ideal   = processFuzzy(29, 20, 'Normal');
      const warning = processFuzzy(29, 20, 'Warning');
      expect(warning.score).toBeGreaterThan(ideal.score);
      expect(['Waspada', 'Bahaya']).toContain(warning.recommendation);
    });

    test('Visual = Caution meningkatkan skor dibanding Normal', () => {
      const normal  = processFuzzy(29, 20, 'Normal');
      const caution = processFuzzy(29, 20, 'Caution');
      expect(caution.score).toBeGreaterThan(normal.score);
    });

    test('Visual Warning (default) sama dengan tanpa parameter ke-3', () => {
      // processFuzzy default param = 'Normal'
      const withDefault = processFuzzy(29, 20);
      const withNormal  = processFuzzy(29, 20, 'Normal');
      expect(withDefault.score).toBe(withNormal.score);
      expect(withDefault.recommendation).toBe(withNormal.recommendation);
    });
  });

  // ── Format Output ────────────────────────────────────────────────────────
  describe('Format Output', () => {
    test('Hasil processFuzzy memiliki semua field yang diperlukan', () => {
      const result = processFuzzy(29, 20, 'Normal');
      expect(result).toHaveProperty('suhu_membership');
      expect(result).toHaveProperty('salinitas_membership');
      expect(result).toHaveProperty('visual_label');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('recommendation');
      expect(result).toHaveProperty('fired_rules');
    });

    test('score dalam rentang valid [0, 100]', () => {
      const scenarios = [
        [20, 5], [20, 20], [20, 40],
        [29, 5], [29, 20], [29, 40],
        [35, 5], [35, 20], [35, 40],
      ];
      scenarios.forEach(([t, s]) => {
        const r = processFuzzy(t, s, 'Normal');
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
      });
    });

    test('score dibulatkan ke 2 desimal', () => {
      const result = processFuzzy(29, 20, 'Normal');
      const str = result.score.toString();
      const decimals = str.includes('.') ? str.split('.')[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(2);
    });

    test('fired_rules adalah array dan setiap rule punya field wajib', () => {
      const result = processFuzzy(29, 20, 'Normal');
      expect(Array.isArray(result.fired_rules)).toBe(true);
      result.fired_rules.forEach((rule) => {
        expect(rule).toHaveProperty('rule_id');
        expect(rule).toHaveProperty('weight');
        expect(rule).toHaveProperty('output_label');
        expect(rule).toHaveProperty('description');
        expect(rule.weight).toBeGreaterThan(0);
      });
    });

    test('weight pada fired_rules dibulatkan ke 4 desimal', () => {
      const result = processFuzzy(27, 18, 'Normal');
      result.fired_rules.forEach((rule) => {
        const str = rule.weight.toString();
        const decimals = str.includes('.') ? str.split('.')[1].length : 0;
        expect(decimals).toBeLessThanOrEqual(4);
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 7: Skenario Batas & Edge Cases
// ─────────────────────────────────────────────────────────────────────────────
describe('🔧 Edge Cases & Boundary Values', () => {
  test('Suhu tepat di crossover rendah-normal (26°C) — keduanya = 0', () => {
    // t=26: rendah = (26-26)/(26-24) = 0 (sudah habis)
    //        normal memerlukan t>26, jadi normal = 0 juga
    //        → titik dead zone persis di 26°C
    const mu = fuzzySuhu(26);
    expect(mu.rendah).toBe(0);
    expect(mu.normal).toBe(0);
    expect(mu.tinggi).toBe(0);
  });

  test('Suhu tepat di puncak normal (29°C) — normal = 1, lain = 0', () => {
    const mu = fuzzySuhu(29);
    expect(mu.normal).toBe(1);
    expect(mu.rendah).toBe(0);
    expect(mu.tinggi).toBe(0);
  });

  test('Salinitas di zona overlap rendah-normal (14ppt)', () => {
    const mu = fuzzySalinitas(14);
    // rendah: (15-14)/(15-12) = 1/3
    // normal: (14-12)/(17-12) = 2/5
    expect(r4(mu.rendah)).toBe(r4(1 / 3));
    expect(r4(mu.normal)).toBe(r4(2 / 5));
  });

  test('Seluruh 9 skenario ekstrem crisp menghasilkan rekomendasi valid', () => {
    const extremes = [
      [15, 5],  // suhu rendah + salinitas rendah
      [15, 20], // suhu rendah + salinitas normal
      [15, 40], // suhu rendah + salinitas tinggi
      [29, 5],  // suhu normal + salinitas rendah
      [29, 20], // suhu normal + salinitas normal (ideal)
      [29, 40], // suhu normal + salinitas tinggi
      [38, 5],  // suhu tinggi + salinitas rendah
      [38, 20], // suhu tinggi + salinitas normal
      [38, 40], // suhu tinggi + salinitas tinggi
    ];
    extremes.forEach(([t, s]) => {
      const r = processFuzzy(t, s, 'Normal');
      expect(['Aman', 'Waspada', 'Bahaya']).toContain(r.recommendation);
    });
  });

  test('Kondisi sangat ekstrem kedua-duanya tinggi + Warning → Bahaya kritis (score tinggi)', () => {
    const result = processFuzzy(40, 50, 'Warning');
    expect(result.recommendation).toBe('Bahaya');
    expect(result.score).toBeGreaterThanOrEqual(80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 8: getRuleDefinitions — Definisi 27 Aturan
// ─────────────────────────────────────────────────────────────────────────────
describe('📖 getRuleDefinitions() — Rule Catalog', () => {
  let rules;
  beforeAll(() => { rules = getRuleDefinitions(); });

  test('Menghasilkan tepat 27 aturan', () => {
    expect(rules.length).toBe(27);
  });

  test('Setiap aturan memiliki field wajib', () => {
    rules.forEach((rule) => {
      expect(rule).toHaveProperty('rule_id');
      expect(rule).toHaveProperty('suhu');
      expect(rule).toHaveProperty('salinitas');
      expect(rule).toHaveProperty('visual');
      expect(rule).toHaveProperty('output');
      expect(rule).toHaveProperty('label');
      expect(rule).toHaveProperty('description');
    });
  });

  test('Rule ID unik (tidak ada duplikat)', () => {
    const ids = rules.map(r => r.rule_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(27);
  });

  test('Rule ID format R01 sampai R27', () => {
    const ids = rules.map(r => r.rule_id);
    for (let i = 1; i <= 27; i++) {
      const id = `R${String(i).padStart(2, '0')}`;
      expect(ids).toContain(id);
    }
  });

  test('Nilai output hanya 20, 50, 65, 80, atau 95', () => {
    const validOutputs = new Set([20, 50, 65, 80, 95]);
    rules.forEach((rule) => {
      expect(validOutputs.has(rule.output)).toBe(true);
    });
  });

  test('Label hanya "Aman", "Waspada", atau "Bahaya"', () => {
    const validLabels = new Set(['Aman', 'Waspada', 'Bahaya']);
    rules.forEach((rule) => {
      expect(validLabels.has(rule.label)).toBe(true);
    });
  });

  test('Hanya R13 yang berlabel "Aman" (kondisi ideal)', () => {
    const amanRules = rules.filter(r => r.label === 'Aman');
    expect(amanRules.length).toBe(1);
    expect(amanRules[0].rule_id).toBe('R13');
  });

  test('R03, R09, R21, R27 (kondisi kritis semua) output = 95', () => {
    const criticalRules = rules.filter(r =>
      ['R03', 'R09', 'R21', 'R27'].includes(r.rule_id)
    );
    expect(criticalRules.length).toBe(4);
    criticalRules.forEach(r => expect(r.output).toBe(95));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 9: Konsistensi Logika Bisnis (Properti Monoton)
// ─────────────────────────────────────────────────────────────────────────────
describe('📐 Konsistensi Logika Bisnis', () => {
  test('Skor meningkat saat suhu makin jauh dari optimal (29°C)', () => {
    const scores = [29, 31, 33, 35, 38].map(t =>
      processFuzzy(t, 20, 'Normal').score
    );
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i + 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  test('Skor meningkat saat suhu makin rendah dari optimal', () => {
    const scores = [29, 27, 25, 22, 18].map(t =>
      processFuzzy(t, 20, 'Normal').score
    );
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i + 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  test('Normal < Caution < Warning dari sisi skor visual', () => {
    const base = [29, 20]; // suhu & salinitas normal
    const scoreNormal  = processFuzzy(...base, 'Normal').score;
    const scoreCaution = processFuzzy(...base, 'Caution').score;
    const scoreWarning = processFuzzy(...base, 'Warning').score;
    expect(scoreCaution).toBeGreaterThan(scoreNormal);
    expect(scoreWarning).toBeGreaterThan(scoreCaution);
  });

  test('Kondisi ideal (suhu + salinitas normal) selalu lebih aman dari kondisi buruk', () => {
    const ideal  = processFuzzy(29, 20, 'Normal').score;
    const bad1   = processFuzzy(15, 20, 'Normal').score;
    const bad2   = processFuzzy(29, 5, 'Normal').score;
    const bad3   = processFuzzy(38, 40, 'Normal').score;
    expect(ideal).toBeLessThan(bad1);
    expect(ideal).toBeLessThan(bad2);
    expect(ideal).toBeLessThan(bad3);
  });
});
