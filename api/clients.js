const supabase = require('./_db');

export default async function handler(req, res) {
  // pharma ?¼ìš°??
  if (req.url && req.url.startsWith('/api/pharma')) return handlePharma(req, res);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET ??ëª©ë¡ ì¡°íšŒ
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('master_clients')
      .select('*')
      .order('name', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  }

  // POST ???±ë¡/?˜ì •
  if (req.method === 'POST') {
    const client = req.body;
    if (!client.name) {
      return res.status(400).json({ error: 'ê±°ë˜ì²˜ëª…?€ ?„ìˆ˜?…ë‹ˆ??' });
    }

    const { error } = await supabase
      .from('master_clients')
      .upsert({
        id:      client.id,
        name:    client.name,
        bizno:   client.bizno   || '',
        region:  client.region  || '',
        manager: client.manager || '',
        note:    client.note    || '',
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // DELETE ???? œ
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id ?„ìš”' });

    const { error } = await supabase
      .from('master_clients')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ?€?€ PHARMA ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
async function handlePharma(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('master_pharma').select('*').order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  }

  if (req.method === 'POST') {
    const item = req.body;
    if (!item.name) return res.status(400).json({ error: '?œì•½?¬ëª… ?„ìˆ˜' });
    const { error } = await supabase.from('master_pharma').upsert({
      id:          item.id,
      name:        item.name,
      codes:       item.codes      || [],
      code_rates:  item.codeRates  || [],
      non_insured: item.nonInsured || [],
      active:      item.active !== false,
      updated_at:  new Date().toISOString()
    }, { onConflict: 'id' });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id ?„ìš”' });
    const { error } = await supabase.from('master_pharma').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
