/**
 * Fuzzy Logic DSS (Mamdani) Engine for B-Monitor
 * Inputs: Suhu (Temperature °C), Salinitas (Salinity ppt)
 * Output: DSS Score (0-100) → Aman / Waspada / Bahaya
 */

function fuzzySuhu(value) {
  let dingin = 0, normal = 0, panas = 0;
  
  if (value <= 26) dingin = 1;
  else if (value > 26 && value < 28) dingin = (28 - value) / (28 - 26);
  
  if (value > 26 && value <= 28) normal = (value - 26) / (28 - 26);
  else if (value > 28 && value < 30) normal = 1;
  else if (value >= 30 && value < 32) normal = (32 - value) / (32 - 30);
  
  if (value > 30 && value <= 32) panas = (value - 30) / (32 - 30);
  else if (value > 32) panas = 1;
  
  return { dingin, normal, panas };
}

function fuzzySalinitas(value) {
  let rendah = 0, normal = 0, tinggi = 0;
  
  if (value <= 15) rendah = 1;
  else if (value > 15 && value < 20) rendah = (20 - value) / (20 - 15);
  
  if (value > 15 && value <= 20) normal = (value - 15) / (20 - 15);
  else if (value > 20 && value < 25) normal = 1;
  else if (value >= 25 && value < 30) normal = (30 - value) / (30 - 25);
  
  if (value > 25 && value <= 30) tinggi = (value - 25) / (30 - 25);
  else if (value > 30) tinggi = 1;
  
  return { rendah, normal, tinggi };
}

function evaluateRules(suhu, salinitas) {
  return [
    { weight: Math.min(suhu.dingin, salinitas.rendah), output: 75, label: 'Bahaya' },
    { weight: Math.min(suhu.dingin, salinitas.normal), output: 50, label: 'Waspada' },
    { weight: Math.min(suhu.dingin, salinitas.tinggi), output: 75, label: 'Bahaya' },
    { weight: Math.min(suhu.normal, salinitas.rendah), output: 50, label: 'Waspada' },
    { weight: Math.min(suhu.normal, salinitas.normal), output: 25, label: 'Aman' },
    { weight: Math.min(suhu.normal, salinitas.tinggi), output: 50, label: 'Waspada' },
    { weight: Math.min(suhu.panas, salinitas.rendah), output: 75, label: 'Bahaya' },
    { weight: Math.min(suhu.panas, salinitas.normal), output: 50, label: 'Waspada' },
    { weight: Math.min(suhu.panas, salinitas.tinggi), output: 75, label: 'Bahaya' },
  ];
}

function defuzzify(rules) {
  let numerator = 0;
  let denominator = 0;
  
  for (const rule of rules) {
    if (rule.weight > 0) {
      numerator += rule.weight * rule.output;
      denominator += rule.weight;
    }
  }
  
  if (denominator === 0) return 0;
  return numerator / denominator;
}

function getRecommendation(score) {
  if (score <= 35) return 'Aman';
  if (score <= 60) return 'Waspada';
  return 'Bahaya';
}

function getDominantMembership(memberships) {
  let dominant = '';
  let maxVal = -1;
  for (const [key, value] of Object.entries(memberships)) {
    if (value > maxVal) {
      maxVal = value;
      dominant = key;
    }
  }
  return dominant;
}

function processFuzzy(suhuValue, salinitasValue) {
  const suhuMem = fuzzySuhu(suhuValue);
  const salinitasMem = fuzzySalinitas(salinitasValue);
  
  const rules = evaluateRules(suhuMem, salinitasMem);
  const score = defuzzify(rules);
  const recommendation = getRecommendation(score);
  
  const activeRules = rules.filter(r => r.weight > 0).map(r => ({
    weight: parseFloat(r.weight.toFixed(2)),
    output_label: r.label
  }));

  return {
    suhu_membership: getDominantMembership(suhuMem),
    salinitas_membership: getDominantMembership(salinitasMem),
    score: parseFloat(score.toFixed(2)),
    recommendation,
    fired_rules: activeRules
  };
}

module.exports = {
  processFuzzy
};
