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
      if (company && company.trim()) {
        query = query.ilike('company_name', `%${company.trim()}%`);
      }
    }

    const limitCount = req.query.limit ? parseInt(req.query.limit) : 1000;

    let otcQuery = supabase
      .from('drug_master_otc')
      .select('item_seq, item_name, entp_name, item_ingr_name, edi_code');

    if (searchType === 'company') {
      otcQuery = otcQuery.ilike('entp_name', `%${kw}%`);
    } else if (searchType === 'code') {
      otcQuery = otcQuery.eq('edi_code', kw);
    } else {
      otcQuery = otcQuery.ilike('item_name', `%${kw}%`);
    }

    const [{ data: rows, error }, { data: otcRows, error: otcError }] = await Promise.all([
      query.limit(Math.min(limitCount, 1000)),
      otcQuery.limit(Math.min(limitCount, 1000))
    ]);
    if (error) throw new Error(error.message);
    if (otcError) throw new Error(otcError.message);

    const isAutocomplete = req.query.autocomplete === '1';
    const commissionMap = isAutocomplete ? {} : await fetchCommissionMap();

    const data = (rows || []).map(row => {
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
        payTpNm: row.pay_tp_nm || '',
        isBioequivalence: row.is_bioequivalence || false,
        priceEvalResult: row.price_eval_result || null,
        commissionRate,
        commissionAmt
      };
    });

    const otcData = (otcRows || []).map(row => ({
      itmNm: row.item_name || '',
      cpnyNm: row.entp_name || '',
      itmCd: row.edi_code || row.item_seq || '',
      mnfSeq: row.item_seq || '',
      clsgAmt: 0,
      ingdCd: '',
      ingdNm: row.item_ingr_name || '',
      payTpNm: '비급여',
      isBioequivalence: false,
      priceEvalResult: null,
      commissionRate: 0,
      commissionAmt: 0
    }));

    const combined = [...data, ...otcData];

    res.json({ data: combined, allDrugs: combined, total: combined.length });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: '검색 중 오류가 발생했습니다.' });
  }
};
