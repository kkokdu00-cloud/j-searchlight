'use strict';

const { supabase, ok, err, setCors, requireAuth } = require('./_utils');

// POST   /api/cso/inspection?action=run
// GET    /api/cso/inspection?action=results&pharma_id=
// GET    /api/cso/inspection?action=result&id=
// POST   /api/cso/inspection?action=correct
// GET    /api/cso/inspection?action=corrections&pharma_id=&inspection_id=
// GET    /api/cso/inspection?action=tolerance&pharma_id=
// PUT    /api/cso/inspection?action=tolerance
// POST   /api/cso/inspection?action=hospital_summary

async function getTolerance(pharma_id) {
  const { data } = await supabase.from('cso_settings')
    .select('value').eq('pharma_id', pharma_id).eq('key', 'tolerance').single();
  return data ? JSON.parse(data.value) : { amt_abs: 100, amt_pct: 1, qty: 0 };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  const { action, id, pharma_id, inspection_id } = req.query;

  try {
    // ── 허용오차 조회
    if (req.method === 'GET' && action === 'tolerance') {
      return ok(res, await getTolerance(pharma_id));
    }

    // ── 허용오차 설정
    if (req.method === 'PUT' && action === 'tolerance') {
      const { pharma_id: pid, amt_abs, amt_pct, qty } = req.body;
      const val = JSON.stringify({
        amt_abs: parseFloat(amt_abs) || 0,
        amt_pct: parseFloat(amt_pct) || 0,
        qty:     parseInt(qty)      || 0
      });
      await supabase.from('cso_settings').upsert(
        { pharma_id: parseInt(pid), key: 'tolerance', value: val },
        { onConflict: 'pharma_id,key' }
      );
      return ok(res, JSON.parse(val));
    }

    // ── 검수 결과 목록
    if (req.method === 'GET' && action === 'results') {
      const { data, error } = await supabase.from('inspection_results')
        .select('id,pharma_id,ref_month,prescription_upload_id,settlement_upload_id,created_at')
        .eq('pharma_id', pharma_id).order('id', { ascending: false });
      if (error) return err(res, error.message, 500);
      return ok(res, data || []);
    }

    // ── 검수 결과 단건
    if (req.method === 'GET' && action === 'result') {
      if (!id) return err(res, 'id 필수');
      const { data: row } = await supabase.from('inspection_results').select('*').eq('id', id).single();
      if (!row) return err(res, '결과 없음', 404);
      const result = JSON.parse(row.result_json);
      const { data: corrections } = await supabase.from('correction_log')
        .select('*').eq('inspection_id', id).order('id');
      const corrMap = {};
      for (const c of (corrections || [])) corrMap[JSON.parse(c.row_data).idx] = c;
      for (const r of result.rows) {
        if (corrMap[r.idx]) r._correction = { action: corrMap[r.idx].action, reason: corrMap[r.idx].reason };
      }
      return ok(res, { ...row, result });
    }

    // ── 정정 로그
    if (req.method === 'GET' && action === 'corrections') {
      let q = supabase.from('correction_log').select('*').eq('pharma_id', pharma_id);
      if (inspection_id) q = q.eq('inspection_id', inspection_id);
      const { data, error } = await q.order('id', { ascending: false });
      if (error) return err(res, error.message, 500);
      return ok(res, data || []);
    }

    // ── 정정 등록
    if (req.method === 'POST' && action === 'correct') {
      const { pharma_id: pid, inspection_id: iid, row_idx, action: act, reason, ref_month } = req.body;
      const { data: result } = await supabase.from('inspection_results')
        .select('result_json').eq('id', iid).single();
      if (!result) return err(res, '검수 결과 없음');
      const data = JSON.parse(result.result_json);
      const row = data.rows.find(r => r.idx === parseInt(row_idx));
      if (!row) return err(res, '행 없음');
      await supabase.from('correction_log').insert({
        pharma_id: parseInt(pid),
        inspection_id: parseInt(iid),
        ref_month: ref_month || data.ref_month,
        row_data: JSON.stringify({ idx: row.idx, settlement: row.settlement }),
        action: act, reason: reason || ''
      });
      return ok(res, { ok: true });
    }

    // ── 검수 실행
    if (req.method === 'POST' && action === 'run') {
      const { pharma_id: pid, prescription_upload_id, settlement_upload_id, ref_month } = req.body;
      if (!pid || !prescription_upload_id || !settlement_upload_id) return err(res, '필수 파라미터 없음');

      const { data: prescrRows } = await supabase.from('cso_upload_data')
        .select('data_json').eq('upload_id', prescription_upload_id).eq('pharma_id', pid);
      const { data: settleRows } = await supabase.from('cso_upload_data')
        .select('data_json').eq('upload_id', settlement_upload_id).eq('pharma_id', pid);

      const prescriptions = (prescrRows || []).map(r => JSON.parse(r.data_json));
      const settlements   = (settleRows  || []).map(r => JSON.parse(r.data_json));
      const tolerance = await getTolerance(pid);

      const mkKey = (row, type) => {
        const bn = (row.biz_no || '').trim();
        const hn = (row.hospital_name || '').trim();
        const ic = (row.ins_code || '').trim();
        const pn = (row.product_name || '').trim();
        switch(type) {
          case 'bi': return bn && ic ? `${bn}|${ic}` : null;
          case 'bp': return bn && pn ? `${bn}|${pn}` : null;
          case 'hi': return hn && ic ? `${hn}|${ic}` : null;
          case 'hp': return hn && pn ? `${hn}|${pn}` : null;
        }
        return null;
      };

      const maps = { bi:{}, bp:{}, hi:{}, hp:{} };
      for (const p of prescriptions) {
        for (const t of ['bi','bp','hi','hp']) {
          const k = mkKey(p, t);
          if (k) { if (!maps[t][k]) maps[t][k] = []; maps[t][k].push(p); }
        }
      }

      const usedPrescr = new Set();
      const rows = settlements.map((settle, idx) => {
        let match = null, matchType = null;
        for (const t of ['bi','bp','hi','hp']) {
          const k = mkKey(settle, t);
          if (k && maps[t][k]) {
            const candidates = maps[t][k].filter(p => !usedPrescr.has(p));
            if (candidates.length) { match = candidates[0]; matchType = t; break; }
          }
        }
        if (!match) return { idx, settlement: settle, prescription: null, match_type: null, status: 'fail', diff: null };

        usedPrescr.add(match);
        const pAmt = match.amount || 0, sAmt = settle.amount || 0;
        const pQty = match.quantity || 0, sQty = settle.quantity || 0;
        const amtDiff = Math.abs(pAmt - sAmt);
        const amtRate = pAmt > 0 ? amtDiff / pAmt * 100 : (sAmt > 0 ? 100 : 0);
        const qtyDiff = Math.abs(pQty - sQty);
        const amtOk = amtDiff <= tolerance.amt_abs || amtRate <= tolerance.amt_pct;
        const qtyOk = qtyDiff <= tolerance.qty;

        let status;
        if (amtOk && qtyOk) status = (amtDiff === 0 && qtyDiff === 0) ? 'ok' : 'cok';
        else if (!amtOk && !qtyOk) status = 'check';
        else if (!qtyOk) status = 'qty';
        else status = 'amt';

        return { idx, settlement: settle, prescription: match, match_type: matchType, status,
          diff: { amt_diff: pAmt - sAmt, amt_rate: parseFloat(amtRate.toFixed(2)), qty_diff: pQty - sQty } };
      });

      const summary = { ok:0, cok:0, check:0, fail:0, qty:0, amt:0 };
      for (const r of rows) summary[r.status]++;

      const resultJson = JSON.stringify({ prescription_upload_id, settlement_upload_id, ref_month, tolerance, rows, summary });
      const { data: inserted } = await supabase.from('inspection_results').insert({
        pharma_id: parseInt(pid), ref_month: ref_month || '',
        prescription_upload_id, settlement_upload_id, result_json: resultJson
      }).select().single();

      return ok(res, { id: inserted.id, summary, rows });
    }

    // ── 병의원별 합계표 비교
    if (req.method === 'POST' && action === 'hospital_summary') {
      const { pharma_id: pid, prescription_upload_id, summary_data } = req.body;
      if (!pid || !prescription_upload_id || !summary_data?.length) return err(res, '필수 파라미터 없음');

      const { data: prescrRows } = await supabase.from('cso_upload_data')
        .select('data_json').eq('upload_id', prescription_upload_id).eq('pharma_id', pid).order('row_index');
      if (!prescrRows?.length) return err(res, '처방 데이터가 없습니다');

      function normalizeName(name) {
        return (name || '').replace(/\s*\d{1,2}월\s*/g, '').replace(/\s*20\d{2}[-./]\d{1,2}\s*/g, '').replace(/\s+/g, '').toLowerCase();
      }

      const prescrMap = {};
      for (const r of prescrRows) {
        const row = JSON.parse(r.data_json);
        if (!row.hospital_name && row._raw && row.biz_no) {
          const bizIdx = row._raw.findIndex(v => String(v).replace(/[^0-9]/g, '') === row.biz_no);
          if (bizIdx >= 0 && row._raw[bizIdx + 1]) row.hospital_name = String(row._raw[bizIdx + 1]).trim();
        }
        if (row._raw && row._raw[11] != null && row._raw[12] != null) {
          const sales = parseFloat(row._raw[11]) || 0;
          const fee   = parseFloat(row._raw[12]) || 0;
          if (Math.abs(row.amount - fee) < 1) row.amount = sales;
        }
        const rawName = (row.hospital_name || '').trim();
        if (!rawName) continue;
        const normName = normalizeName(rawName);
        if (!prescrMap[normName]) prescrMap[normName] = { hospital_name: rawName, prescription_amount: 0, biz_no: row.biz_no || '' };
        prescrMap[normName].prescription_amount += row.amount || 0;
      }

      const results = summary_data.map(item => {
        const name = (item.hospital_name || '').trim();
        const normName = normalizeName(name);
        const summaryAmt = parseFloat(String(item.amount).replace(/[^0-9.\-]/g, '')) || 0;
        let matched = prescrMap[normName];
        if (!matched) {
          const key = Object.keys(prescrMap).find(k => k.includes(normName) || normName.includes(k));
          if (key) matched = prescrMap[key];
        }
        const prescrAmt = matched?.prescription_amount || 0;
        const diff = prescrAmt - summaryAmt;
        const diffPct = summaryAmt > 0 ? (Math.abs(diff) / summaryAmt * 100) : 0;
        let status = 'ok';
        if (!matched) status = 'no_match';
        else if (diff === 0) status = 'ok';
        else if (Math.abs(diff) <= 100 || diffPct <= 1) status = 'cok';
        else status = 'diff';
        return { hospital_name: name, summary_amount: summaryAmt, prescription_amount: prescrAmt,
          diff, diff_pct: parseFloat(diffPct.toFixed(2)), status, memo: item.memo || '', matched_name: matched?.hospital_name || null };
      });

      const summaryNormNames = new Set(summary_data.map(s => normalizeName(s.hospital_name || '')));
      const unmatched = Object.entries(prescrMap)
        .filter(([normKey]) => !summaryNormNames.has(normKey) && !Array.from(summaryNormNames).some(sn => normKey.includes(sn) || sn.includes(normKey)))
        .map(([, p]) => ({ hospital_name: p.hospital_name, summary_amount: 0, prescription_amount: p.prescription_amount,
          diff: p.prescription_amount, diff_pct: 100, status: 'prescr_only', memo: '합계표에 없음', matched_name: null }));

      const allResults = [...results, ...unmatched];
      const totals = {
        summary_total: results.reduce((s, r) => s + r.summary_amount, 0),
        prescription_total: allResults.reduce((s, r) => s + r.prescription_amount, 0),
        ok: allResults.filter(r => r.status === 'ok').length,
        cok: allResults.filter(r => r.status === 'cok').length,
        diff: allResults.filter(r => r.status === 'diff').length,
        no_match: allResults.filter(r => r.status === 'no_match').length,
        prescr_only: allResults.filter(r => r.status === 'prescr_only').length,
      };
      totals.total_diff = totals.prescription_total - totals.summary_total;
      return ok(res, { results: allResults, totals });
    }

    return err(res, 'Method not allowed', 405);
  } catch(e) {
    return err(res, e.message, 500);
  }
}
