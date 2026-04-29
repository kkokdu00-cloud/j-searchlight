'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase, ok, err, setCors, JWT_SECRET } = require('./_utils');

// /api/cso/core?resource=auth&action=login
// /api/cso/core?resource=auth&action=me
// /api/cso/core?resource=auth&action=users
// /api/cso/core?resource=auth&action=create
// /api/cso/core?resource=auth&action=reset&id=
// /api/cso/core?resource=auth&action=delete&id=
// /api/cso/core?resource=auth&action=password
// /api/cso/core?resource=pharmas
// /api/cso/core?resource=pharmas&id=

async function ensureAdminExists() {
  const { data } = await supabase.from('cso_users').select('id').limit(1);
  if (!data || data.length === 0) {
    const hash = await bcrypt.hash('admin1234', 10);
    await supabase.from('cso_users').insert({
      username: 'admin', password_hash: hash,
      name: '관리자', role: 'admin', must_change_pw: true
    });
  }
}

function getUser(req) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) return null;
  try { return jwt.verify(header.slice(7), JWT_SECRET); }
  catch { return null; }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { resource, action, id } = req.query;

  try {
    // ════ AUTH ════
    if (resource === 'auth') {
      await ensureAdminExists();

      // 로그인 (인증 불필요)
      if (req.method === 'POST' && action === 'login') {
        const { username, password } = req.body;
        if (!username || !password) return err(res, '아이디와 비밀번호를 입력하세요');
        const { data: users } = await supabase.from('cso_users').select('*').eq('username', username).limit(1);
        const u = users?.[0];
        if (!u) return err(res, '아이디 또는 비밀번호가 올바르지 않습니다', 401);
        const matched = await bcrypt.compare(password, u.password_hash);
        if (!matched) return err(res, '아이디 또는 비밀번호가 올바르지 않습니다', 401);
        const token = jwt.sign(
          { id: u.id, username: u.username, name: u.name, role: u.role },
          JWT_SECRET, { expiresIn: '7d' }
        );
        return ok(res, { token, user: { id: u.id, username: u.username, name: u.name, role: u.role, must_change_pw: u.must_change_pw } });
      }

      const user = getUser(req);
      if (!user) return err(res, '인증이 필요합니다', 401);

      // 내 정보
      if (req.method === 'GET' && action === 'me') {
        const { data: users } = await supabase.from('cso_users').select('id,username,name,role,must_change_pw').eq('id', user.id).limit(1);
        if (!users?.[0]) return err(res, '유저 없음', 404);
        return ok(res, users[0]);
      }

      // 비밀번호 변경
      if (req.method === 'PUT' && action === 'password') {
        const { current_password, new_password } = req.body;
        if (!new_password || new_password.length < 4) return err(res, '새 비밀번호는 4자 이상이어야 합니다');
        const { data: users } = await supabase.from('cso_users').select('*').eq('id', user.id).limit(1);
        const u = users?.[0];
        if (!u) return err(res, '유저 없음', 404);
        if (current_password) {
          const matched = await bcrypt.compare(current_password, u.password_hash);
          if (!matched) return err(res, '현재 비밀번호가 올바르지 않습니다', 401);
        }
        const hash = await bcrypt.hash(new_password, 10);
        await supabase.from('cso_users').update({ password_hash: hash, must_change_pw: false }).eq('id', user.id);
        return ok(res, {});
      }

      if (user.role !== 'admin') return err(res, '관리자 권한이 필요합니다', 403);

      // 유저 목록
      if (req.method === 'GET' && action === 'users') {
        const { data } = await supabase.from('cso_users').select('id,username,name,role,must_change_pw,created_at').order('id');
        return ok(res, data || []);
      }

      // 유저 생성
      if (req.method === 'POST' && action === 'create') {
        const { username, password, name, role } = req.body;
        if (!username || !password || !name) return err(res, 'username, password, name 필수');
        if (password.length < 4) return err(res, '비밀번호는 4자 이상이어야 합니다');
        const hash = await bcrypt.hash(password, 10);
        const { data, error } = await supabase.from('cso_users')
          .insert({ username, password_hash: hash, name, role: role || 'user' })
          .select('id,username,name,role,created_at').single();
        if (error) {
          if (error.code === '23505') return err(res, '이미 사용 중인 아이디입니다');
          return err(res, error.message, 500);
        }
        return ok(res, data);
      }

      // 비밀번호 초기화
      if (req.method === 'POST' && action === 'reset') {
        const { new_password } = req.body;
        if (!new_password || new_password.length < 4) return err(res, '비밀번호는 4자 이상이어야 합니다');
        const hash = await bcrypt.hash(new_password, 10);
        await supabase.from('cso_users').update({ password_hash: hash, must_change_pw: true }).eq('id', id);
        return ok(res, {});
      }

      // 유저 삭제
      if (req.method === 'DELETE' && action === 'delete') {
        if (parseInt(id) === user.id) return err(res, '자신의 계정은 삭제할 수 없습니다');
        const { data: target } = await supabase.from('cso_users').select('role').eq('id', id).single();
        if (target?.role === 'admin') {
          const { count } = await supabase.from('cso_users').select('*', { count: 'exact', head: true }).eq('role', 'admin');
          if (count <= 1) return err(res, '마지막 관리자 계정은 삭제할 수 없습니다');
        }
        await supabase.from('cso_users').delete().eq('id', id);
        return ok(res, { id });
      }
    }

    // ════ PHARMAS ════
    if (resource === 'pharmas') {
      const user = getUser(req);
      if (!user) return err(res, '인증이 필요합니다', 401);

      if (req.method === 'GET') {
        const { data, error } = await supabase.from('cso_pharmas').select('*').order('id');
        if (error) return err(res, error.message, 500);
        return ok(res, data || []);
      }
      if (req.method === 'POST') {
        const { name, color, memo } = req.body;
        if (!name) return err(res, '제약사명 필수');
        const { data, error } = await supabase.from('cso_pharmas')
          .insert({ name, color: color || '#2563eb', memo: memo || '' }).select().single();
        if (error) return err(res, error.message, 500);
        await supabase.from('cso_settings').upsert(
          { pharma_id: data.id, key: 'tolerance', value: JSON.stringify({ amt_abs: 100, amt_pct: 1, qty: 0 }) },
          { onConflict: 'pharma_id,key' }
        );
        return ok(res, data);
      }
      if (req.method === 'PUT') {
        if (!id) return err(res, 'id 필수');
        const { name, color, memo } = req.body;
        const { data, error } = await supabase.from('cso_pharmas')
          .update({ name, color, memo }).eq('id', id).select().single();
        if (error) return err(res, error.message, 500);
        return ok(res, data);
      }
      if (req.method === 'DELETE') {
        if (!id) return err(res, 'id 필수');
        await supabase.from('cso_pharmas').delete().eq('id', id);
        return ok(res, { id });
      }
    }

    return err(res, 'Not found', 404);
  } catch(e) {
    return err(res, e.message, 500);
  }
}
