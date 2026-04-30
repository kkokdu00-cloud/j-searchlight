const supabase = require('./_db');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url || '';

  // ── /api/sep/mapping ────────────────────────────────────────
  if (url.includes('/api/sep/mapping')) {

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('sep_mapping')
        .select('*')
        .order('client_name', { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ data });
    }

    if (req.method === 'POST') {
      // 배열로 받아서 upsert (client_id + pharma_name 조합 unique)
      const items = Array.isArray(req.body) ? req.body : [req.body];
      // 기존 동일 조합 삭제 후 재삽입
      for (const item of items) {
        await supabase.from('sep_mapping')
          .delete()
          .eq('client_id', item.client_id)
          .eq('pharma_name', item.pharma_name);
        if (item.sep_org_id) {
          const { error } = await supabase.from('sep_mapping').insert({
            client_id:    item.client_id,
            client_name:  item.client_name,
            pharma_name:  item.pharma_name,
            sep_org_id:   item.sep_org_id,
            sep_org_name: item.sep_org_name
          });
          if (error) return res.status(500).json({ error: error.message });
        }
      }
      return res.json({ success: true });
    }

    if (req.method === 'DELETE') {
      const { client_id, pharma_name } = req.query;
      if (!client_id || !pharma_name) return res.status(400).json({ error: 'params required' });
      const { error } = await supabase.from('sep_mapping')
        .delete()
        .eq('client_id', client_id)
        .eq('pharma_name', pharma_name);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true });
    }
  }

  // ── /api/sep (제출처 orgs) ──────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('sep_orgs')
      .select('*')
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  }

  if (req.method === 'POST') {
    const item = req.body;
    if (!item.name) return res.status(400).json({ error: '제출처명 필수' });
    if (item.id) {
      const { error } = await supabase.from('sep_orgs')
        .update({ name: item.name, note: item.note || '' })
        .eq('id', item.id);
      if (error) return res.status(500).json({ error: error.message });
    } else {
      const { error } = await supabase.from('sep_orgs')
        .insert({ name: item.name, note: item.note || '' });
      if (error) return res.status(500).json({ error: error.message });
    }
    return res.json({ success: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id 필요' });
    const { error } = await supabase.from('sep_orgs').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
