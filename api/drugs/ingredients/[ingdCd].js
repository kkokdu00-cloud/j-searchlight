const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function fetchCommissionMap() {
  const map = {};
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('drug_commission')
      .select('standard_code, commission_rate')
      .range(from, from + pageSize - 1);
    if (error) { console.error('Supabase error:', error); break; }
    if (data) data.forEach(item => { map[item.standard_code] = item.commission_rate; });
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { ingdCd } = req.query;

    const { data: masterRows, error: masterError } = await supabase
      .from('drug_master')
      .select('product_code, product_name, company_name, mx_cprc, is_bioequivalence, price_eval_result')
      .eq('gnl_nm_cd', ingdCd)
      .in('pay_tp_nm', ['급여', '삭제']);

    if (masterError) {
      console.error('[ingredients] Supabase error:', masterError);
      return res.status(500).json({ error: '성분 조회 중 오류가 발생했습니다.' });
    }

    const commissionMap = await fetchCommissionMap();

    const data = (masterRows || []).map(row => {
      const mdsCd = String(row.product_code || '');
      const commissionRate = commissionMap[mdsCd] || 0;
      const mxCprc = parseFloat(row.mx_cprc) || 0;
      const commissionAmt = Math.round(mxCprc * commissionRate / 100);
      return {
        itmNm: row.product_name || '',
        cpnyNm: row.company_name || '',
        itmCd: mdsCd,
        mnfSeq: mdsCd,
        clsgAmt: mxCprc,
        ingdCd: ingdCd,
        ingdNm: '',
        isBioequivalence: row.is_bioequivalence || false,
        priceEvalResult: row.price_eval_result || null,
        commissionRate,
        commissionAmt
      };
    });

    data.sort((a, b) => b.commissionRate - a.commissionRate);

    const { data: diseaseRows } = await supabase
      .from('disease_codes')
      .select('kcd_code, kcd_name, is_primary')
      .eq('gnl_nm_cd', ingdCd)
      .order('is_primary', { ascending: false });

    res.json({ data, gnlNm: ingdCd, diseaseCodes: diseaseRows || [] });
  } catch (err) {
    console.error('Ingredients error:', err);
    res.status(500).json({ error: '성분 조회 중 오류가 발생했습니다.' });
  }
};
