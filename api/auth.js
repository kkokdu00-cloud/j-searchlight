const supabase = require('./_db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'jsearchlight-jwt-secret';

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
    if (!email || !password) return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });

    const { data, error } = await supabase
      .from('app_users')
      .select('id, email, name, role, password_hash')
      .eq('email', email.trim())
      .single();

    if (error || !data) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    if (data.password_hash !== hashPassword(password)) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });

    // cso_users 자동 동기화 (체크메이트 토큰 발급용)
    let csoToken = null;
    try {
      const hash = await bcrypt.hash(password, 10);
      const { data: existing } = await supabase.from('cso_users').select('id').eq('username', data.email).limit(1);
      if (existing && existing.length > 0) {
        await supabase.from('cso_users').update({ password_hash: hash, name: data.name }).eq('username', data.email);
      } else {
        await supabase.from('cso_users').insert({
          username: data.email, password_hash: hash,
          name: data.name, role: data.role === 'admin' ? 'admin' : 'user', must_change_pw: false
        });
      }
      csoToken = jwt.sign(
        { id: data.id, username: data.email, name: data.name, role: data.role },
        JWT_SECRET, { expiresIn: '7d' }
      );
    } catch(e) { /* CSO 동기화 실패해도 써치라이트는 정상 동작 */ }

    return res.json({ success: true, user: { id: data.id, email: data.email, name: data.name, role: data.role }, csoToken });
  }

  // GET /api/auth?action=users  (관리자???��? 목록)
  if (req.method === 'GET' && action === 'users') {
    const { data, error } = await supabase
      .from('app_users')
      .select('id, email, name, role, created_at')
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  }

  // POST /api/auth?action=create  (관리자???��? ?�성)
  if (req.method === 'POST' && action === 'create') {
    const { email, name, password, role } = req.body;
    if (!email || !name || !password) return res.status(400).json({ error: '필수 항목을 입력해주세요.' });

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

  // PUT /api/auth?action=password  (비�?번호 변�?
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

  // POST /api/auth?action=set_clients  (?��? ?�당 거래�??�괄 ?�정)
  if (req.method === 'POST' && action === 'set_clients') {
    const { user_id, client_ids } = req.body;
    // 기존 ??��
    await supabase.from('user_clients').delete().eq('user_id', user_id);
    // ?�로 ?�입
    if (client_ids && client_ids.length > 0) {
      const rows = client_ids.map(cid => ({ user_id, client_id: cid }));
      const { error } = await supabase.from('user_clients').insert(rows);
      if (error) return res.status(500).json({ error: error.message });
    }
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
