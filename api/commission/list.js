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
    let allData = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('drug_commission')
        .select('*')
        .order('updated_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      allData = allData.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    res.json({ data: allData, total: allData.length });
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: '목록 조회 중 오류가 발생했습니다.' });
  }
};
