const supabase = require('./db');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — 목록 조회
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('master_pharma')
      .select('*')
      .order('name', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  }

  // POST — 등록/수정
  if (req.method === 'POST') {
    const item = req.body;
    if (!item.name) return res.status(400).json({ error: '제약사명 필수' });

    const { error } = await supabase
      .from('master_pharma')
      .upsert({
        id:          item.id,
        name:        item.name,
        codes:       item.codes       || [],
        code_rates:  item.codeRates   || [],
        non_insured: item.nonInsured  || [],
        active:      item.active !== false,
        updated_at:  new Date().toISOString()
      }, { onConflict: 'id' });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // DELETE — 삭제
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id 필요' });

    const { error } = await supabase
      .from('master_pharma')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
