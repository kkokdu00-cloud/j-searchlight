'use strict';

const { supabase, ok, err, setCors, requireAuth } = require('./_utils');

// GET    /api/cso/pharmas
// POST   /api/cso/pharmas
// PUT    /api/cso/pharmas?id=
// DELETE /api/cso/pharmas?id=

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  const { id } = req.query;

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('cso_pharmas').select('*').order('id');
      if (error) return err(res, error.message, 500);
      return ok(res, data || []);
    }

    if (req.method === 'POST') {
      const { name, color, memo } = req.body;
      if (!name) return err(res, '제약사명 필수');
      const { data, error } = await supabase.from('cso_pharmas')
        .insert({ name, color: color || '#2563eb', memo: memo || '' })
        .select().single();
      if (error) return err(res, error.message, 500);
      // 기본 허용오차 설정 추가
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
      const { error } = await supabase.from('cso_pharmas').delete().eq('id', id);
      if (error) return err(res, error.message, 500);
      return ok(res, { id });
    }

    return err(res, 'Method not allowed', 405);
  } catch(e) {
    return err(res, e.message, 500);
  }
}
