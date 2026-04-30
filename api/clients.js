const supabase = require('./_db');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  if (req.url && req.url.startsWith('/api/pharma')) return handlePharma(req, res);
  if (req.url && req.url.startsWith('/api/sep'))    return handleSep(req, res);

  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('master_clients').select('*').order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  }

  if (req.method === 'POST') {
    const client = req.body;
    if (!client.name) return res.status(400).json({ error: '거래처명 필수' });
    const { error } = await supabase.from('master_clients').upsert({
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

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id 필요' });
    const { error } = await supabase.from('master_clients').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── PHARMA ──────────────────────────────────────────────────
async function handlePharma(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('master_pharma').select('*').order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  }

  if (req.method === 'POST') {
    const item = req.body;
    if (!item.name) return res.status(400).json({ error: '제약사명 필수' });
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
    if (!id) return res.status(400).json({ error: 'id 필요' });
    const { error } = await supabase.from('master_pharma').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── SEP ORGS & MAPPING ──────────────────────────────────────
async function handleSep(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url || '';

  // /api/sep/mapping
  if (url.includes('/mapping')) {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('sep_mapping').select('*').order('client_name', { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ data });
    }

    if (req.method === 'POST') {
      const items = Array.isArray(req.body) ? req.body : [req.body];
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
        .delete().eq('client_id', client_id).eq('pharma_name', pharma_name);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // /api/sep (orgs)
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('sep_orgs').select('*').order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  }

  if (req.method === 'POST') {
    const item = req.body;
    if (!item.name) return res.status(400).json({ error: '제출처명 필수' });
    if (item.id) {
      const { error } = await supabase.from('sep_orgs')
        .update({ name: item.name, note: item.note || '' }).eq('id', item.id);
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
