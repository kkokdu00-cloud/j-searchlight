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

function extractKoreanIngredientName(itmNm) {
  if (!itmNm) return '';
  const candidates = [...itmNm.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
  for (const c of candidates) {
    const korean = c.match(/[\uAC00-\uD7AF\u3130-\u318F]+/g);
    if (korean) {
      const totalLen = korean.reduce((sum, w) => sum + w.length, 0);
      if (totalLen >= 2) return c.trim();
    }
  }
  return '';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { searchType, keyword, bioequivalence } = req.query;

    if (!keyword || keyword.trim() === '') {
      return res.status(400).json({ error: '검색어를 입력하세요' });
    }

    const kw = keyword.trim();
    const bioFilter = bioequivalence === 'true';

    let query = supabase
      .from('drug_master')
      .select('product_code, product_name, company_name, gnl_nm_cd, mx_cprc, pay_tp_nm, is_bioequivalence, price_eval_result')
      .in('pay_tp_nm', ['급여', '비급여', '삭제'])
      .gt('mx_cprc', 0);

    if (bioFilter) query = query.eq('is_bioequivalence', true);

    if (searchType === 'company') {
      query = query.ilike('company_name', `%${kw}%`);
    } else if (searchType === 'code') {
      query = query.eq('product_code', kw);
    } else {
      query = query.ilike('product_name', `%${kw}%`);
    }

    const { data: rows, error } = await query.limit(1000);
    if (error) throw new Error(error.message);

    const commissionMap = await fetchCommissionMap();

    const data = (rows || []).map(row => {
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
        ingdCd: row.gnl_nm_cd || '',
        ingdNm: extractKoreanIngredientName(row.product_name || ''),
        payTpNm: row.pay_tp_nm || '',
        isBioequivalence: row.is_bioequivalence || false,
        priceEvalResult: row.price_eval_result || null,
        commissionRate,
        commissionAmt
      };
    });

    res.json({ data, allDrugs: data, total: data.length });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: '검색 중 오류가 발생했습니다.' });
  }
};
