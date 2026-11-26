'use strict';

// Trapezoidal membership [a, b, c, d] shared with /api/dss/rules; adjacent sets sum to 1 in transition zones.
const MEMBERSHIP_SPEC = {
  suhu: {
    rendah: [-Infinity, 17, 17, 18.5],
    normal: [17, 18.5, 28, 29.5],      // C300 plateau: 18.5-28.0 C
    tinggi: [28, 29.5, Infinity, Infinity],
  },
  salinitas: {
    rendah: [-Infinity, 8, 8, 10],
    normal: [8, 10, 35, 37],           // C300 plateau: 10-35 ppt
    tinggi: [35, 37, Infinity, Infinity],
  },
};

// Single-factor critical ramp [full_low, start_low, start_high, full_high]
const CRITICAL_SPEC = {
  suhu     : [15.5, 18.5, 28, 31],
  salinitas: [5, 10, 35, 40],
};

function trapezoid(x, [a, b, c, d]) {
  if (x < b)  return a === -Infinity ? 1 : Math.max(0, (x - a) / (b - a));
  if (x <= c) return 1;
  if (x < d)  return d === Infinity ? 1 : (d - x) / (d - c);
  return d === Infinity ? 1 : 0;
}

function fuzzify(x, spec) {
  return {
    rendah: trapezoid(x, spec.rendah),
    normal: trapezoid(x, spec.normal),
    tinggi: trapezoid(x, spec.tinggi),
  };
}

function fuzzySuhu(t) {
  return fuzzify(t, MEMBERSHIP_SPEC.suhu);
}

function fuzzySalinitas(s) {
  return fuzzify(s, MEMBERSHIP_SPEC.salinitas);
}

// Captures extreme deviation magnitude after low/high membership saturates at 1.
function criticalDegree(x, [lowFull, lowStart, highStart, highFull]) {
  if (x <= lowFull)   return 1;
  if (x < lowStart)   return (lowStart - x) / (lowStart - lowFull);
  if (x >= highFull)  return 1;
  if (x > highStart)  return (x - highStart) / (highFull - highStart);
  return 0;
}

function fuzzyVisual(label) {
  const l = (label || 'Normal').toLowerCase();
  switch (l) {
    case 'normal':  return { normal: 1, caution: 0, warning: 0 };
    case 'caution': return { normal: 0, caution: 1, warning: 0 };
    case 'warning': return { normal: 0, caution: 0, warning: 1 };
    default:        return { normal: 1, caution: 0, warning: 0 };
  }
}

function evaluateRules(suhuMu, salinitasMu, visualMu) {
  const rules = [
    {
      rule_id     : 'R01',
      weight      : Math.min(suhuMu.rendah, salinitasMu.rendah, visualMu.normal),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Rendah & Salinitas Rendah → Bahaya (fisik kritis)',
    },
    {
      rule_id     : 'R02',
      weight      : Math.min(suhuMu.rendah, salinitasMu.rendah, visualMu.caution),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Rendah & Salinitas Rendah & Air Keruh → Bahaya',
    },
    {
      rule_id     : 'R03',
      weight      : Math.min(suhuMu.rendah, salinitasMu.rendah, visualMu.warning),
      output      : 95,
      label       : 'Bahaya',
      description : 'Semua parameter buruk → Bahaya Kritis',
    },
    {
      rule_id     : 'R04',
      weight      : Math.min(suhuMu.rendah, salinitasMu.normal, visualMu.normal),
      output      : 50,
      label       : 'Waspada',
      description : 'Suhu Rendah, Salinitas Normal, Air Jernih → Waspada',
    },
    {
      rule_id     : 'R05',
      weight      : Math.min(suhuMu.rendah, salinitasMu.normal, visualMu.caution),
      output      : 65,
      label       : 'Waspada',
      description : 'Suhu Rendah & Air Mulai Keruh → Waspada Tinggi',
    },
    {
      rule_id     : 'R06',
      weight      : Math.min(suhuMu.rendah, salinitasMu.normal, visualMu.warning),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Rendah & Air Sangat Keruh → Bahaya',
    },
    {
      rule_id     : 'R07',
      weight      : Math.min(suhuMu.rendah, salinitasMu.tinggi, visualMu.normal),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Rendah & Salinitas Tinggi → Bahaya',
    },
    {
      rule_id     : 'R08',
      weight      : Math.min(suhuMu.rendah, salinitasMu.tinggi, visualMu.caution),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Rendah & Salinitas Tinggi & Air Keruh → Bahaya',
    },
    {
      rule_id     : 'R09',
      weight      : Math.min(suhuMu.rendah, salinitasMu.tinggi, visualMu.warning),
      output      : 95,
      label       : 'Bahaya',
      description : 'Semua parameter buruk (suhu rendah side) → Bahaya Kritis',
    },
    {
      rule_id     : 'R10',
      weight      : Math.min(suhuMu.normal, salinitasMu.rendah, visualMu.normal),
      output      : 50,
      label       : 'Waspada',
      description : 'Salinitas Rendah, Suhu & Visual OK → Waspada',
    },
    {
      rule_id     : 'R11',
      weight      : Math.min(suhuMu.normal, salinitasMu.rendah, visualMu.caution),
      output      : 65,
      label       : 'Waspada',
      description : 'Salinitas Rendah & Air Mulai Keruh → Waspada Tinggi',
    },
    {
      rule_id     : 'R12',
      weight      : Math.min(suhuMu.normal, salinitasMu.rendah, visualMu.warning),
      output      : 80,
      label       : 'Bahaya',
      description : 'Salinitas Rendah & Air Sangat Keruh → Bahaya',
    },
    {
      rule_id     : 'R13',
      weight      : Math.min(suhuMu.normal, salinitasMu.normal, visualMu.normal),
      output      : 20,
      label       : 'Aman',
      description : 'Semua parameter optimal → Aman',
    },
    {
      rule_id     : 'R14',
      weight      : Math.min(suhuMu.normal, salinitasMu.normal, visualMu.caution),
      output      : 50,
      label       : 'Waspada',
      description : 'Fisik Optimal, Air Mulai Keruh → Waspada',
    },
    {
      rule_id     : 'R15',
      weight      : Math.min(suhuMu.normal, salinitasMu.normal, visualMu.warning),
      output      : 80,
      label       : 'Bahaya',
      description : 'Fisik Optimal tapi Air Sangat Keruh (Algae Bloom) → Bahaya (Eskalasi Kritis)',
    },
    {
      rule_id     : 'R16',
      weight      : Math.min(suhuMu.normal, salinitasMu.tinggi, visualMu.normal),
      output      : 50,
      label       : 'Waspada',
      description : 'Salinitas Tinggi, Suhu & Visual OK → Waspada',
    },
    {
      rule_id     : 'R17',
      weight      : Math.min(suhuMu.normal, salinitasMu.tinggi, visualMu.caution),
      output      : 65,
      label       : 'Waspada',
      description : 'Salinitas Tinggi & Air Mulai Keruh → Waspada Tinggi',
    },
    {
      rule_id     : 'R18',
      weight      : Math.min(suhuMu.normal, salinitasMu.tinggi, visualMu.warning),
      output      : 80,
      label       : 'Bahaya',
      description : 'Salinitas Tinggi & Air Sangat Keruh → Bahaya',
    },
    {
      rule_id     : 'R19',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.rendah, visualMu.normal),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Tinggi & Salinitas Rendah → Bahaya',
    },
    {
      rule_id     : 'R20',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.rendah, visualMu.caution),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Tinggi & Salinitas Rendah & Air Keruh → Bahaya',
    },
    {
      rule_id     : 'R21',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.rendah, visualMu.warning),
      output      : 95,
      label       : 'Bahaya',
      description : 'Semua parameter buruk (suhu tinggi side) → Bahaya Kritis',
    },
    {
      rule_id     : 'R22',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.normal, visualMu.normal),
      output      : 50,
      label       : 'Waspada',
      description : 'Suhu Tinggi, Salinitas & Visual OK → Waspada',
    },
    {
      rule_id     : 'R23',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.normal, visualMu.caution),
      output      : 65,
      label       : 'Waspada',
      description : 'Suhu Tinggi & Air Mulai Keruh → Waspada Tinggi',
    },
    {
      rule_id     : 'R24',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.normal, visualMu.warning),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Tinggi & Air Sangat Keruh → Bahaya',
    },
    {
      rule_id     : 'R25',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.tinggi, visualMu.normal),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Tinggi & Salinitas Tinggi → Bahaya',
    },
    {
      rule_id     : 'R26',
      weight      : Math.min(suhuMu.tinggi, salinitasMu.tinggi, visualMu.caution),
      output      : 80,
      label       : 'Bahaya',
      description : 'Suhu Tinggi & Salinitas Tinggi & Air Keruh → Bahaya',
    },
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

// Thresholds match actuatorController (36 / 66).
function getRecommendation(score) {
  if (score < 36) return 'Aman';
  if (score < 66) return 'Waspada';
  return 'Bahaya';
}

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

function processFuzzy(suhuValue, salinitasValue, visualLabel = 'Normal') {
  const suhuMu      = fuzzySuhu(suhuValue);
  const salinitasMu = fuzzySalinitas(salinitasValue);
  const visualMu    = fuzzyVisual(visualLabel);

  const rules       = evaluateRules(suhuMu, salinitasMu, visualMu);
  let score         = defuzzify(rules);

  // Severity floor ensures extreme single-factor deviation reaches Bahaya (80 at extremity=1).
  const extremity = Math.max(
    criticalDegree(suhuValue, CRITICAL_SPEC.suhu),
    criticalDegree(salinitasValue, CRITICAL_SPEC.salinitas)
  );
  const severityFloor = 50 + 30 * extremity;
  if (extremity > 0 && severityFloor > score) score = severityFloor;
  const recommendation = getRecommendation(score);

  const firedRules  = rules
    .filter(r => r.weight > 0)
    .map(r => ({
      rule_id     : r.rule_id,
      weight      : parseFloat(r.weight.toFixed(4)),
      output_label: r.label,
      description : r.description,
    }));

  if (extremity > 0.5) {
    firedRules.push({
      rule_id     : 'X01',
      weight      : parseFloat(extremity.toFixed(4)),
      output_label: 'Bahaya',
      description : 'Deviasi ekstrem satu faktor (lantai keparahan) → Bahaya',
    });
  }

  return {
    suhu_membership     : getDominantMembership(suhuMu),
    salinitas_membership: getDominantMembership(salinitasMu),
    visual_label        : visualLabel || 'Normal',
    score               : parseFloat(score.toFixed(2)),
    recommendation,
    fired_rules         : firedRules,
  };
}

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
    { rule_id: 'R15', suhu: 'Normal', salinitas: 'Normal', visual: 'Warning', output: 80, label: 'Bahaya', description: 'Fisik Optimal tapi Air Sangat Keruh (Algae Bloom) → Bahaya (Eskalasi Kritis)' },
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
  fuzzySuhu,
  fuzzySalinitas,
  fuzzyVisual,
  MEMBERSHIP_SPEC,
  defuzzify,
  getRecommendation,
};
