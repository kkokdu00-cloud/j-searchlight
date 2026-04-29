'use strict';

const formidable = require('formidable');
const XLSX = require('xlsx');
const { supabase, ok, err, setCors, requireAuth,
        cleanBizNo, detectColumns, transformRow, separateByMapping, isSkipRow,
        buildOutputRow, buildSeparationExcel, buildExcel, safeDecodeFileName } = require('./_utils');

export const config = { api: { bodyParser: false } };

async function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: 50 * 1024 * 1024 });
    form.parse(req, (e, fields, files) => {
      if (e) reject(e); else resolve({ fields, files });
    });
  });
}

function fv(fields, k) {
  return Array.isArray(fields[k]) ? fields[k][0] : fields[k];
}

async function getTolerance(pharma_id) {
  const { data } = await supabase.from('cso_settings')
    .select('value').eq('pharma_id', pharma_id).eq('key', 'tolerance').single();
  return data ? JSON.parse(data.value) : { amt_abs: 100, amt_pct: 1, qty: 0 };
}

// resource=upload  action=history|data|download|detect|save
// resource=separation  action=orgs|rules|mapping|mapping_upload|mapping_add|run|download
// resource=inspection  action=run|results|result|correct|corrections|tolerance

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  const isMultipart = req.headers['content-type']?.includes('multipart/form-data');
  let body = req.body || {};
  let files = {};

  if (isMultipart) {
    const parsed = await parseForm(req);
    body = Object.fromEntries(Object.keys(parsed.fields).map(k => [k, fv(parsed.fields, k)]));
    files = parsed.files;
  }

  const { resource, action, id, pharma_id } = req.query;

  try {

    // ════════════════════════════════════════════════════════════
    // UPLOAD
    // ════════════════════════════════════════════════════════════
    if (resource === 'upload') {

      if (req.method === 'GET' && action === 'history') {
        let q = supabase.from('cso_upload_history').select('*').order('id', { ascending: false });
        if (pharma_id) q = q.eq('pharma_id', pharma_id); else q = q.limit(100);
        const { data, error } = await q;
        if (error) return err(res, error.message, 500);
        return ok(res, data || []);
      }

      if (req.method === 'GET' && action === 'data') {
        if (!id) return err(res, 'id 필수');
        const { data, error } = await supabase.from('cso_upload_data')
          .select('data_json,row_index').eq('upload_id', id).order('row_index');
        if (error) return err(res, error.message, 500);
        return ok(res, (data || []).map(r => JSON.parse(r.data_json)));
      }

      if (req.method === 'GET' && action === 'download') {
        if (!id) return err(res, 'id 필수');
        const { data: hist } = await supabase.from('cso_upload_history').select('*').eq('id', id).single();
        if (!hist) return err(res, '업로드 없음', 404);
        const { data: rows } = await supabase.from('cso_upload_data').select('data_json').eq('upload_id', id).order('row_index');
        const headerArr = hist.header_json ? JSON.parse(hist.header_json) : null;
        const data = (rows || []).map(r => buildOutputRow(JSON.parse(r.data_json), headerArr));
        const buf = buildExcel([{ name: '데이터', data }]);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(hist.file_name + '_변환.xlsx')}`);
        return res.send(buf);
      }

      if (req.method === 'POST' && action === 'detect') {
        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        if (!file) return err(res, '파일이 없습니다');
        const fileType = body.file_type || 'prescription';
        const fs = require('fs');
        const buf = fs.readFileSync(file.filepath);
        const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const detected = detectColumns(rows, fileType);
        const preview = rows.slice(detected.headerRow + 1, detected.headerRow + 6)
          .map(r => transformRow(r, detected.columnMap, fileType));
        const fileName = safeDecodeFileName(file.originalFilename || file.newFilename);
        return ok(res, { ...detected, preview, totalRows: rows.length - detected.headerRow - 1, fileName });
      }

      if (req.method === 'POST' && action === 'save') {
        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        if (!file) return err(res, '파일이 없습니다');
        const pid = body.pharma_id;
        if (!pid) return err(res, 'pharma_id 필수');
        const fileType = body.file_type || 'prescription';
        const headerRowParam = parseInt(body.header_row || '0');
        const refMonth = body.ref_month || '';
        const columnMapJson = body.column_map_json;
        const fs = require('fs');
        const buf = fs.readFileSync(file.filepath);
        const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        let columnMap = columnMapJson ? JSON.parse(columnMapJson) : detectColumns(rows, fileType).columnMap;
        const startRow = headerRowParam + 1;
        const headerRowArr = rows[startRow - 1] || [];
        const headerJson = JSON.stringify(headerRowArr.map(h => String(h || '').trim()));
        const dataRows = rows.slice(startRow).filter(r => r.some(c => c !== '' && c != null));
        const fileName = safeDecodeFileName(file.originalFilename || file.newFilename);
        const { data: hist, error: histErr } = await supabase.from('cso_upload_history')
          .insert({ pharma_id: parseInt(pid), file_type: fileType, file_name: fileName,
            ref_month: refMonth, row_count: dataRows.length,
            column_map: JSON.stringify(columnMap), header_json: headerJson }).select().single();
        if (histErr) return err(res, histErr.message, 500);
        const BATCH = 500;
        for (let i = 0; i < dataRows.length; i += BATCH) {
          const batch = dataRows.slice(i, i + BATCH).map((row, j) => {
            const transformed = transformRow(row, columnMap, fileType);
            transformed._raw = row;
            return { upload_id: hist.id, pharma_id: parseInt(pid), row_index: i + j, data_json: JSON.stringify(transformed) };
          });
          const { error: batchErr } = await supabase.from('cso_upload_data').insert(batch);
          if (batchErr) return err(res, batchErr.message, 500);
        }
        return ok(res, { upload_id: hist.id, row_count: dataRows.length, file_name: fileName });
      }

      if (req.method === 'DELETE') {
        if (!id) return err(res, 'id 필수');
        await supabase.from('cso_upload_data').delete().eq('upload_id', id);
        await supabase.from('cso_upload_history').delete().eq('id', id);
        return ok(res, { id });
      }
    }

    // ════════════════════════════════════════════════════════════
    // SEPARATION
    // ════════════════════════════════════════════════════════════
    if (resource === 'separation') {

      if (action === 'orgs') {
        if (req.method === 'GET') {
          const { data, error } = await supabase.from('sep_orgs').select('*').eq('pharma_id', pharma_id).order('id');
          if (error) return err(res, error.message, 500);
          return ok(res, data || []);
        }
        if (req.method === 'POST') {
          const { pharma_id: pid, name, color, memo } = body;
          if (!pid || !name) return err(res, 'pharma_id, name 필수');
          const { data, error } = await supabase.from('sep_orgs')
            .insert({ pharma_id: parseInt(pid), name, color: color || '#2563eb', memo: memo || '' }).select().single();
          if (error) return err(res, error.message, 500);
          return ok(res, data);
        }
        if (req.method === 'PUT') {
          const { name, color, memo } = body;
          const { data, error } = await supabase.from('sep_orgs').update({ name, color, memo }).eq('id', id).select().single();
          if (error) return err(res, error.message, 500);
          return ok(res, data);
        }
        if (req.method === 'DELETE') {
          await supabase.from('sep_orgs').delete().eq('id', id);
          return ok(res, { id });
        }
      }

      if (action === 'rules') {
        if (req.method === 'GET') {
          const { data, error } = await supabase.from('sep_rules').select('*').eq('pharma_id', pharma_id).order('priority');
          if (error) return err(res, error.message, 500);
          return ok(res, data || []);
        }
        if (req.method === 'POST') {
          const { pharma_id: pid, type, value, std_name, settle_name, memo } = body;
          if (!pid || !type || !value || !settle_name) return err(res, 'pharma_id, type, value, settle_name 필수');
          const { data, error } = await supabase.from('sep_rules')
            .insert({ pharma_id: parseInt(pid), type, value, std_name: std_name || '', settle_name, memo: memo || '' }).select().single();
          if (error) return err(res, error.message, 500);
          return ok(res, data);
        }
        if (req.method === 'PUT') {
          const { type, value, std_name, settle_name, memo } = body;
          const { data, error } = await supabase.from('sep_rules').update({ type, value, std_name, settle_name, memo }).eq('id', id).select().single();
          if (error) return err(res, error.message, 500);
          return ok(res, data);
        }
        if (req.method === 'DELETE') {
          await supabase.from('sep_rules').delete().eq('id', id);
          return ok(res, { id });
        }
      }

      if (action === 'mapping') {
        if (req.method === 'GET') {
          const { data, error } = await supabase.from('sep_mapping').select('*').eq('pharma_id', pharma_id).order('id');
          if (error) return err(res, error.message, 500);
          return ok(res, data || []);
        }
        if (req.method === 'DELETE') {
          await supabase.from('sep_mapping').delete().eq('pharma_id', pharma_id);
          return ok(res, {});
        }
      }

      if (action === 'mapping_upload' && req.method === 'POST') {
        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        if (!file) return err(res, '파일이 없습니다');
        const pid = body.pharma_id;
        if (!pid) return err(res, 'pharma_id 필수');
        const fs = require('fs');
        const buf = fs.readFileSync(file.filepath);
        const wb = XLSX.read(buf, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        let headerRow = 0;
        for (let i = 0; i < Math.min(20, rows.length); i++) {
          if (rows[i].map(c => String(c).trim()).some(c => c.includes('정산처'))) { headerRow = i; break; }
        }
        const headers = rows[headerRow].map(c => String(c).trim());
        const idxHospital = headers.findIndex(h => ['병원명','처방처명','처방처','거래처명','기관명','키값'].some(k => h.includes(k)));
        const idxBizNo    = headers.findIndex(h => h.includes('사업자번호'));
        const idxPharma   = headers.findIndex(h => h.includes('제약회사') || h.includes('제약사'));
        const idxSettle   = headers.findIndex(h => h.includes('정산처'));
        if (idxSettle === -1) return err(res, '정산처 컬럼을 찾을 수 없습니다');
        const dataRows = rows.slice(headerRow + 1).filter(r => r.some(c => c !== '' && c != null));
        await supabase.from('sep_mapping').delete().eq('pharma_id', parseInt(pid));
        const batch = dataRows.map(row => {
          const settle = String(row[idxSettle] ?? '').trim();
          if (!settle) return null;
          return {
            pharma_id: parseInt(pid),
            hospital_name: idxHospital >= 0 ? String(row[idxHospital] ?? '').trim() : '',
            biz_no: idxBizNo >= 0 ? cleanBizNo(row[idxBizNo]) : '',
            pharma_company: idxPharma >= 0 ? String(row[idxPharma] ?? '').trim() : '',
            settle_org: settle
          };
        }).filter(Boolean);
        const BATCH = 500;
        for (let i = 0; i < batch.length; i += BATCH) {
          const { error } = await supabase.from('sep_mapping').insert(batch.slice(i, i + BATCH));
          if (error) return err(res, error.message, 500);
        }
        return ok(res, { count: batch.length });
      }

      if (action === 'mapping_add' && req.method === 'POST') {
        const { pharma_id: pid, hospital_name, biz_no, settle_org } = body;
        if (!pid || !settle_org) return err(res, 'pharma_id, settle_org 필수');
        await supabase.from('sep_mapping').insert({ pharma_id: parseInt(pid), hospital_name: hospital_name || '', biz_no: cleanBizNo(biz_no) || '', settle_org });
        return ok(res, {});
      }

      if (action === 'run' && req.method === 'POST') {
        const { pharma_id: pid, upload_id } = body;
        if (!pid || !upload_id) return err(res, 'pharma_id, upload_id 필수');
        const { data: dataRows } = await supabase.from('cso_upload_data').select('data_json').eq('upload_id', upload_id).eq('pharma_id', pid).order('row_index');
        if (!dataRows?.length) return err(res, '업로드 데이터가 없습니다');
        const { data: mappings } = await supabase.from('sep_mapping').select('*').eq('pharma_id', pid);
        if (!mappings?.length) return err(res, '매핑 파일이 없습니다. 먼저 매핑 파일을 업로드하세요');
        const results = dataRows.map(r => JSON.parse(r.data_json)).filter(row => !isSkipRow(row, null)).map(row => {
          const { settle_org, matched_by } = separateByMapping(row, mappings);
          const { _raw, ...cleanRow } = row;
          return { ...cleanRow, _settle_org: settle_org, _matched_by: matched_by };
        });
        const grouped = {};
        for (const r of results) { const org = r._settle_org || '미분류'; if (!grouped[org]) grouped[org] = []; grouped[org].push(r); }
        const totalAmt = results.reduce((s, r) => s + (r.amount || 0), 0);
        const summary = Object.entries(grouped).map(([org, rows]) => {
          const amt = rows.reduce((s, r) => s + (r.amount || 0), 0);
          return { settle_org: org, count: rows.length, amount: amt, pct: totalAmt > 0 ? (amt / totalAmt * 100).toFixed(1) : 0 };
        }).sort((a, b) => b.amount - a.amount);
        return ok(res, { results, grouped, summary, total: results.length, unclassified: (grouped['미분류'] || []).length });
      }

      if (action === 'download' && req.method === 'GET') {
        const { pharma_id: pid, upload_id } = req.query;
        const { data: hist } = await supabase.from('cso_upload_history').select('header_json').eq('id', upload_id).single();
        const headerArr = hist?.header_json ? JSON.parse(hist.header_json) : null;
        const { data: dataRows } = await supabase.from('cso_upload_data').select('data_json').eq('upload_id', upload_id).eq('pharma_id', pid).order('row_index');
        const { data: mappings } = await supabase.from('sep_mapping').select('*').eq('pharma_id', pid);
        const grouped = {};
        for (const dr of (dataRows || [])) {
          const row = JSON.parse(dr.data_json);
          if (isSkipRow(row, null)) continue;
          const { settle_org } = separateByMapping(row, mappings || []);
          const org = settle_org || '미분류';
          if (!grouped[org]) grouped[org] = [];
          grouped[org].push(row);
        }
        const firstParsed = dataRows?.[0] ? JSON.parse(dataRows[0].data_json) : null;
        let buf;
        if (headerArr && firstParsed?._raw) {
          const orgSheets = Object.entries(grouped).filter(([org]) => org !== '미분류').map(([name, rows]) => ({ name, rows }));
          if (grouped['미분류']?.length) orgSheets.push({ name: '미분류', rows: grouped['미분류'] });
          buf = buildSeparationExcel(orgSheets, headerArr, null);
        } else {
          buf = buildExcel(Object.entries(grouped).map(([org, rows]) => ({ name: org.slice(0, 31), data: rows.map(r => { const o = buildOutputRow(r, headerArr); o['정산처'] = org; return o; }) })));
        }
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="separation.xlsx"');
        return res.send(buf);
      }
    }

    // ════════════════════════════════════════════════════════════
    // INSPECTION
    // ════════════════════════════════════════════════════════════
    if (resource === 'inspection') {

      if (req.method === 'GET' && action === 'tolerance') {
        return ok(res, await getTolerance(pharma_id));
      }

      if (req.method === 'PUT' && action === 'tolerance') {
        const { pharma_id: pid, amt_abs, amt_pct, qty } = req.body;
        const val = JSON.stringify({ amt_abs: parseFloat(amt_abs)||0, amt_pct: parseFloat(amt_pct)||0, qty: parseInt(qty)||0 });
        await supabase.from('cso_settings').upsert({ pharma_id: parseInt(pid), key: 'tolerance', value: val }, { onConflict: 'pharma_id,key' });
        return ok(res, JSON.parse(val));
      }

      if (req.method === 'GET' && action === 'results') {
        const { data, error } = await supabase.from('inspection_results')
          .select('id,pharma_id,ref_month,prescription_upload_id,settlement_upload_id,created_at')
          .eq('pharma_id', pharma_id).order('id', { ascending: false });
        if (error) return err(res, error.message, 500);
        return ok(res, data || []);
      }

      if (req.method === 'GET' && action === 'result') {
        if (!id) return err(res, 'id 필수');
        const { data: row } = await supabase.from('inspection_results').select('*').eq('id', id).single();
        if (!row) return err(res, '결과 없음', 404);
        const result = JSON.parse(row.result_json);
        const { data: corrections } = await supabase.from('correction_log').select('*').eq('inspection_id', id).order('id');
        const corrMap = {};
        for (const c of (corrections || [])) corrMap[JSON.parse(c.row_data).idx] = c;
        for (const r of result.rows) { if (corrMap[r.idx]) r._correction = { action: corrMap[r.idx].action, reason: corrMap[r.idx].reason }; }
        return ok(res, { ...row, result });
      }

      if (req.method === 'GET' && action === 'corrections') {
        const { inspection_id: iid } = req.query;
        let q = supabase.from('correction_log').select('*').eq('pharma_id', pharma_id);
        if (iid) q = q.eq('inspection_id', iid);
        const { data, error } = await q.order('id', { ascending: false });
        if (error) return err(res, error.message, 500);
        return ok(res, data || []);
      }

      if (req.method === 'POST' && action === 'correct') {
        const { pharma_id: pid, inspection_id: iid, row_idx, action: act, reason, ref_month } = req.body;
        const { data: result } = await supabase.from('inspection_results').select('result_json').eq('id', iid).single();
        if (!result) return err(res, '검수 결과 없음');
        const data = JSON.parse(result.result_json);
        const row = data.rows.find(r => r.idx === parseInt(row_idx));
        if (!row) return err(res, '행 없음');
        await supabase.from('correction_log').insert({ pharma_id: parseInt(pid), inspection_id: parseInt(iid), ref_month: ref_month || data.ref_month, row_data: JSON.stringify({ idx: row.idx, settlement: row.settlement }), action: act, reason: reason || '' });
        return ok(res, { ok: true });
      }

      if (req.method === 'POST' && action === 'run') {
        const { pharma_id: pid, prescription_upload_id, settlement_upload_id, ref_month } = req.body;
        if (!pid || !prescription_upload_id || !settlement_upload_id) return err(res, '필수 파라미터 없음');
        const { data: prescrRows } = await supabase.from('cso_upload_data').select('data_json').eq('upload_id', prescription_upload_id).eq('pharma_id', pid);
        const { data: settleRows } = await supabase.from('cso_upload_data').select('data_json').eq('upload_id', settlement_upload_id).eq('pharma_id', pid);
        const prescriptions = (prescrRows || []).map(r => JSON.parse(r.data_json));
        const settlements   = (settleRows  || []).map(r => JSON.parse(r.data_json));
        const tolerance = await getTolerance(pid);
        const mkKey = (row, type) => {
          const bn = (row.biz_no||'').trim(), hn = (row.hospital_name||'').trim(), ic = (row.ins_code||'').trim(), pn = (row.product_name||'').trim();
          switch(type) { case 'bi': return bn&&ic?`${bn}|${ic}`:null; case 'bp': return bn&&pn?`${bn}|${pn}`:null; case 'hi': return hn&&ic?`${hn}|${ic}`:null; case 'hp': return hn&&pn?`${hn}|${pn}`:null; }
          return null;
        };
        const maps = { bi:{}, bp:{}, hi:{}, hp:{} };
        for (const p of prescriptions) { for (const t of ['bi','bp','hi','hp']) { const k = mkKey(p,t); if(k){if(!maps[t][k])maps[t][k]=[];maps[t][k].push(p);} } }
        const usedPrescr = new Set();
        const rows = settlements.map((settle, idx) => {
          let match = null, matchType = null;
          for (const t of ['bi','bp','hi','hp']) { const k = mkKey(settle,t); if(k&&maps[t][k]){const c=maps[t][k].filter(p=>!usedPrescr.has(p));if(c.length){match=c[0];matchType=t;break;}} }
          if (!match) return { idx, settlement: settle, prescription: null, match_type: null, status: 'fail', diff: null };
          usedPrescr.add(match);
          const pAmt=match.amount||0, sAmt=settle.amount||0, pQty=match.quantity||0, sQty=settle.quantity||0;
          const amtDiff=Math.abs(pAmt-sAmt), amtRate=pAmt>0?amtDiff/pAmt*100:(sAmt>0?100:0), qtyDiff=Math.abs(pQty-sQty);
          const amtOk=amtDiff<=tolerance.amt_abs||amtRate<=tolerance.amt_pct, qtyOk=qtyDiff<=tolerance.qty;
          let status; if(amtOk&&qtyOk)status=(amtDiff===0&&qtyDiff===0)?'ok':'cok'; else if(!amtOk&&!qtyOk)status='check'; else if(!qtyOk)status='qty'; else status='amt';
          return { idx, settlement: settle, prescription: match, match_type: matchType, status, diff: { amt_diff: pAmt-sAmt, amt_rate: parseFloat(amtRate.toFixed(2)), qty_diff: pQty-sQty } };
        });
        const summary = { ok:0, cok:0, check:0, fail:0, qty:0, amt:0 };
        for (const r of rows) summary[r.status]++;
        const resultJson = JSON.stringify({ prescription_upload_id, settlement_upload_id, ref_month, tolerance, rows, summary });
        const { data: inserted } = await supabase.from('inspection_results').insert({ pharma_id: parseInt(pid), ref_month: ref_month||'', prescription_upload_id, settlement_upload_id, result_json: resultJson }).select().single();
        return ok(res, { id: inserted.id, summary, rows });
      }

      if (req.method === 'POST' && action === 'hospital_summary') {
        const { pharma_id: pid, prescription_upload_id, summary_data } = req.body;
        if (!pid || !prescription_upload_id || !summary_data?.length) return err(res, '필수 파라미터 없음');
        const { data: prescrRows } = await supabase.from('cso_upload_data').select('data_json').eq('upload_id', prescription_upload_id).eq('pharma_id', pid).order('row_index');
        if (!prescrRows?.length) return err(res, '처방 데이터가 없습니다');
        function normalizeName(name) { return (name||'').replace(/\s*\d{1,2}월\s*/g,'').replace(/\s*20\d{2}[-./]\d{1,2}\s*/g,'').replace(/\s+/g,'').toLowerCase(); }
        const prescrMap = {};
        for (const r of prescrRows) {
          const row = JSON.parse(r.data_json);
          if (!row.hospital_name && row._raw && row.biz_no) { const bizIdx=row._raw.findIndex(v=>String(v).replace(/[^0-9]/g,'')===row.biz_no); if(bizIdx>=0&&row._raw[bizIdx+1])row.hospital_name=String(row._raw[bizIdx+1]).trim(); }
          if (row._raw&&row._raw[11]!=null&&row._raw[12]!=null) { const sales=parseFloat(row._raw[11])||0,fee=parseFloat(row._raw[12])||0; if(Math.abs(row.amount-fee)<1)row.amount=sales; }
          const rawName=(row.hospital_name||'').trim(); if(!rawName)continue;
          const normName=normalizeName(rawName);
          if(!prescrMap[normName])prescrMap[normName]={hospital_name:rawName,prescription_amount:0,biz_no:row.biz_no||''};
          prescrMap[normName].prescription_amount+=row.amount||0;
        }
        const results = summary_data.map(item => {
          const name=(item.hospital_name||'').trim(), normName=normalizeName(name);
          const summaryAmt=parseFloat(String(item.amount).replace(/[^0-9.\-]/g,''))||0;
          let matched=prescrMap[normName];
          if(!matched){const key=Object.keys(prescrMap).find(k=>k.includes(normName)||normName.includes(k));if(key)matched=prescrMap[key];}
          const prescrAmt=matched?.prescription_amount||0, diff=prescrAmt-summaryAmt, diffPct=summaryAmt>0?(Math.abs(diff)/summaryAmt*100):0;
          let status='ok'; if(!matched)status='no_match'; else if(diff===0)status='ok'; else if(Math.abs(diff)<=100||diffPct<=1)status='cok'; else status='diff';
          return {hospital_name:name,summary_amount:summaryAmt,prescription_amount:prescrAmt,diff,diff_pct:parseFloat(diffPct.toFixed(2)),status,memo:item.memo||'',matched_name:matched?.hospital_name||null};
        });
        const summaryNormNames=new Set(summary_data.map(s=>normalizeName(s.hospital_name||'')));
        const unmatched=Object.entries(prescrMap).filter(([normKey])=>!summaryNormNames.has(normKey)&&!Array.from(summaryNormNames).some(sn=>normKey.includes(sn)||sn.includes(normKey))).map(([,p])=>({hospital_name:p.hospital_name,summary_amount:0,prescription_amount:p.prescription_amount,diff:p.prescription_amount,diff_pct:100,status:'prescr_only',memo:'합계표에 없음',matched_name:null}));
        const allResults=[...results,...unmatched];
        const totals={summary_total:results.reduce((s,r)=>s+r.summary_amount,0),prescription_total:allResults.reduce((s,r)=>s+r.prescription_amount,0),ok:allResults.filter(r=>r.status==='ok').length,cok:allResults.filter(r=>r.status==='cok').length,diff:allResults.filter(r=>r.status==='diff').length,no_match:allResults.filter(r=>r.status==='no_match').length,prescr_only:allResults.filter(r=>r.status==='prescr_only').length};
        totals.total_diff=totals.prescription_total-totals.summary_total;
        return ok(res, { results: allResults, totals });
      }
    }

    return err(res, 'Not found', 404);
  } catch(e) {
    return err(res, e.message, 500);
  }
}
