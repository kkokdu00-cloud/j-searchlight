const supabase = require('./_db');
const crypto = require('crypto');

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + 'jsearchlight_salt').digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // POST /api/auth?action=login
  if (req.method === 'POST' && action === 'login') {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: '?´ë©”?¼ê³¼ ë¹„ë?ë²ˆí˜¸ë¥??…ë ¥?´ì£¼?¸ìš”.' });

    const { data, error } = await supabase
      .from('app_users')
      .select('id, email, name, role, password_hash')
      .eq('email', email.trim())
      .single();

    if (error || !data) return res.status(401).json({ error: '?´ë©”???ëŠ” ë¹„ë?ë²ˆí˜¸ê°€ ?¬ë°”ë¥´ì? ?ŠìŠµ?ˆë‹¤.' });
    if (data.password_hash !== hashPassword(password)) return res.status(401).json({ error: '?´ë©”???ëŠ” ë¹„ë?ë²ˆí˜¸ê°€ ?¬ë°”ë¥´ì? ?ŠìŠµ?ˆë‹¤.' });

    return res.json({ success: true, user: { id: data.id, email: data.email, name: data.name, role: data.role } });
  }

  // GET /api/auth?action=users  (ê´€ë¦¬ìž??? ì? ëª©ë¡)
  if (req.method === 'GET' && action === 'users') {
    const { data, error } = await supabase
      .from('app_users')
      .select('id, email, name, role, created_at')
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  }

  // POST /api/auth?action=create  (ê´€ë¦¬ìž??? ì? ?ì„±)
  if (req.method === 'POST' && action === 'create') {
    const { email, name, password, role } = req.body;
    if (!email || !name || !password) return res.status(400).json({ error: '?„ìˆ˜ ??ª©???…ë ¥?´ì£¼?¸ìš”.' });

    const { error } = await supabase.from('app_users').insert({
      email: email.trim(),
      name,
      role: role || 'user',
      password_hash: hashPassword(password)
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // DELETE /api/auth?action=delete&id=xxx
  if (req.method === 'DELETE' && action === 'delete') {
    const { id } = req.query;
    const { error } = await supabase.from('app_users').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // PUT /api/auth?action=password  (ë¹„ë?ë²ˆí˜¸ ë³€ê²?
  if (req.method === 'PUT' && action === 'password') {
    const { id, password } = req.body;
    const { error } = await supabase.from('app_users').update({ password_hash: hashPassword(password) }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // GET /api/auth?action=user_clients&user_id=xxx
  if (req.method === 'GET' && action === 'user_clients') {
    const { user_id } = req.query;
    const { data, error } = await supabase
      .from('user_clients')
      .select('client_id')
      .eq('user_id', user_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data: data.map(r => r.client_id) });
  }

  // POST /api/auth?action=set_clients  (? ì? ?´ë‹¹ ê±°ëž˜ì²??¼ê´„ ?¤ì •)
  if (req.method === 'POST' && action === 'set_clients') {
    const { user_id, client_ids } = req.body;
    // ê¸°ì¡´ ?? œ
    await supabase.from('user_clients').delete().eq('user_id', user_id);
    // ?ˆë¡œ ?½ìž…
    if (client_ids && client_ids.length > 0) {
      const rows = client_ids.map(cid => ({ user_id, client_id: cid }));
      const { error } = await supabase.from('user_clients').insert(rows);
      if (error) return res.status(500).json({ error: error.message });
    }
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
