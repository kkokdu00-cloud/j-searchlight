const supabase = require('./db');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { codes } = req.body;
  if (!codes || !codes.length) {
    return res.status(400).json({ error: 'codes 배열 필요' });
  }

  // drug_master에서 보험코드 → 제품정보 일괄 조회
  const { data, error } = await supabase
    .from('drug_master')
    .select('product_code, product_name, company_name, mx_cprc')
    .in('product_code', codes);

  if (error) return res.status(500).json({ error: error.message });

  // drug_commission에서 수수료율 조회
  const { data: commData } = await supabase
    .from('drug_commission')
    .select('standard_code, commission_rate')
    .in('standard_code', codes);

  const commMap = {};
  (commData || []).forEach(row => { commMap[row.standard_code] = row.commission_rate; });

  // { 보험코드: 제품정보+수수료 } 맵으로 변환
  const map = {};
  (data || []).forEach(row => {
    if (!map[row.product_code]) {
      map[row.product_code] = {
        company_name: row.company_name,
        product_name: row.product_name,
        mx_cprc: row.mx_cprc,
        commission_rate: commMap[row.product_code] || 0
      };
    }
  });

  return res.json({ map });
}