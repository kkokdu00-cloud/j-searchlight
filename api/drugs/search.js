const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

let _commissionMapCache = null;
let _commissionMapLoading = null;

async function fetchCommissionMap() {
  if (_commissionMapCache) return _commissionMapCache;
  if (_commissionMapLoading) return _commissionMapLoading;
  _commissionMapLoading = (async () => {
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
    _commissionMapCache = map;
    return map;
  })();
  return _commissionMapLoading;
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
    const { searchType, keyword, bioequivalence, company } = req.query;

    if (!keyword || keyword.trim() === '') {
      return res.status(400).json({ error: '검색어를 입력하세요' });
    }

    const kw = keyword.trim();
    const bioFilter = bioequivalence === 'true';
    const limitCount = req.query.limit ? parseInt(req.query.limit) : 1000;
    const isAutocomplete = req.query.autocomplete === '1';

    // --- drug_master 쿼리 ---
    let q1 = supabase
      .from('drug_master')
      .select('product_code, product_name, company_name, gnl_nm_cd, mx_cprc, pay_tp_nm, is_bioequivalence, price_eval_result')
      .in('pay_tp_nm', ['급여', '비급여', '삭제'])
      .gt('mx_cprc', 0);

    if (bioFilter) q1 = q1.eq('is_bioequivalence', true);

    if (searchType === 'company') {
      q1 = q1.ilike('company_name', `%${kw}%`);
    } else if (searchType === 'code') {
      q1 = q1.eq('product_code', kw);
    } else {
      q1 = q1.ilike('product_name', `%${kw}%`);
      if (company && company.trim()) q1 = q1.ilike('company_name', `%${company.trim()}%`);
    }

    // --- drug_master_otc 쿼리 ---
    let q2 = supabase
      .from('drug_master_otc')
      .select('product_code, product_name, company_name, gnl_nm_cd, mx_cprc');

    if (searchType === 'company') {
      q2 = q2.ilike('company_name', `%${kw}%`);
    } else if (searchType === 'code') {
      q2 = q2.eq('product_code', kw);
    } else {
      q2 = q2.ilike('product_name', `%${kw}%`);
      if (company && company.trim()) q2 = q2.ilike('company_name', `%${company.trim()}%`);
    }

    const [{ data: rows1, error: e1 }, { data: rows2, error: e2 }] = await Promise.all([
      q1.limit(Math.min(limitCount, 1000)),
      q2.limit(Math.min(limitCount, 1000))
    ]);

    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const commissionMap = isAutocomplete ? {} : await fetchCommissionMap();

    const mapRow = (row, isOtc = false) => {
      const mdsCd = String(row.product_code || '');
      const mxCprc = parseFloat(row.mx_cprc) || 0;
      const commissionRate = isAutocomplete ? 0 : (commissionMap[mdsCd] || 0);
      const commissionAmt = isAutocomplete ? 0 : Math.round(mxCprc * commissionRate / 100);
      return {
        itmNm: row.product_name || '',
        cpnyNm: row.company_name || '',
        itmCd: mdsCd,
        mnfSeq: mdsCd,
        clsgAmt: mxCprc,
        ingdCd: row.gnl_nm_cd || '',
        ingdNm: extractKoreanIngredientName(row.product_name || ''),
        payTpNm: isOtc ? '비급여' : (row.pay_tp_nm || ''),
        isBioequivalence: row.is_bioequivalence || false,
        priceEvalResult: row.price_eval_result || null,
        commissionRate,
        commissionAmt
      };
    };

    const data = [
      ...(rows1 || []).map(r => mapRow(r, false)),
      ...(rows2 || []).map(r => mapRow(r, true))
    ];

    res.json({ data, allDrugs: data, total: data.length });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: '검색 중 오류가 발생했습니다.' });
  }
};
