const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { keyword } = req.query;

    if (!keyword || keyword.trim() === '') {
      return res.status(400).json({ error: '검색어를 입력하세요' });
    }

    const kw = keyword.trim();

    const { data: rows, error } = await supabase
      .from('drug_master_otc')
      .select('item_seq, item_name, entp_name, item_ingr_name, edi_code')
      .ilike('item_ingr_name', `%${kw}%`)
      .limit(1000);

    if (error) throw new Error(error.message);

    const data = (rows || []).map(row => ({
      itmNm: row.item_name || '',
      cpnyNm: row.entp_name || '',
      itmCd: row.edi_code || row.item_seq || '',
      mnfSeq: row.item_seq || '',
      clsgAmt: 0,
      ingdNm: row.item_ingr_name || '',
      payTpNm: '비급여'
    }));

    res.json({ data });
  } catch (err) {
    console.error('OTC ingredient search error:', err);
    res.status(500).json({ error: '성분 검색 중 오류가 발생했습니다.' });
  }
};
