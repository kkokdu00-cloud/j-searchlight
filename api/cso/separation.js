'use strict';

const formidable = require('formidable');
const XLSX = require('xlsx');
const { supabase, ok, err, setCors, requireAuth,
        cleanBizNo, detectColumns, separateByMapping, isSkipRow,
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

// GET    /api/cso/separation?action=orgs&pharma_id=
// POST   /api/cso/separation?action=orgs
// PUT    /api/cso/separation?action=orgs&id=
// DELETE /api/cso/separation?action=orgs&id=
// GET    /api/cso/separation?action=rules&pharma_id=
// POST   /api/cso/separation?action=rules
// PUT    /api/cso/separation?action=rules&id=
// DELETE /api/cso/separation?action=rules&id=
// GET    /api/cso/separation?action=mapping&pharma_id=
// POST   /api/cso/separation?action=mapping_upload   (multipart)
// POST   /api/cso/separation?action=mapping_add
// DELETE /api/cso/separation?action=mapping&pharma_id=
// POST   /api/cso/separation?action=run
// GET    /api/cso/separation?action=download&pharma_id=&upload_id=

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  // multipart 요청 처리
  const isMultipart = req.headers['content-type']?.includes('multipart/form-data');
  let body = req.body || {};
  let query = req.query;

  if (isMultipart) {
    const { fields, files } = await parseForm(req);
    const fv = (k) => Array.isArray(fields[k]) ? fields[k][0] : fields[k];
    body = Object.fromEntries(Object.keys(fields).map(k => [k, fv(k)]));
    body._files = files;
  }

  const action = query.action;
  const id = query.id;

  try {
    // ════ ORGS ════
    if (action === 'orgs') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('sep_orgs')
          .select('*').eq('pharma_id', query.pharma_id).order('id');
        if (error) return err(res, error.message, 500);
        return ok(res, data || []);
      }
      if (req.method === 'POST') {
        const { pharma_id, name, color, memo } = body;
        if (!pharma_id || !name) return err(res, 'pharma_id, name 필수');
        const { data, error } = await supabase.from('sep_orgs')
          .insert({ pharma_id: parseInt(pharma_id), name, color: color || '#2563eb', memo: memo || '' })
          .select().single();
        if (error) return err(res, error.message, 500);
        return ok(res, data);
      }
      if (req.method === 'PUT') {
        if (!id) return err(res, 'id 필수');
        const { name, color, memo } = body;
        const { data, error } = await supabase.from('sep_orgs')
          .update({ name, color, memo }).eq('id', id).select().single();
        if (error) return err(res, error.message, 500);
        return ok(res, data);
      }
      if (req.method === 'DELETE') {
        if (!id) return err(res, 'id 필수');
        await supabase.from('sep_orgs').delete().eq('id', id);
        return ok(res, { id });
      }
    }

    // ════ RULES ════
    if (action === 'rules') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('sep_rules')
          .select('*').eq('pharma_id', query.pharma_id).order('priority');
        if (error) return err(res, error.message, 500);
        return ok(res, data || []);
      }
      if (req.method === 'POST') {
        const { pharma_id, type, value, std_name, settle_name, memo } = body;
        if (!pharma_id || !type || !value || !settle_name) return err(res, 'pharma_id, type, value, settle_name 필수');
        const { data, error } = await supabase.from('sep_rules')
          .insert({ pharma_id: parseInt(pharma_id), type, value, std_name: std_name || '', settle_name, memo: memo || '' })
          .select().single();
        if (error) return err(res, error.message, 500);
        return ok(res, data);
      }
      if (req.method === 'PUT') {
        if (!id) return err(res, 'id 필수');
        const { type, value, std_name, settle_name, memo } = body;
        const { data, error } = await supabase.from('sep_rules')
          .update({ type, value, std_name, settle_name, memo }).eq('id', id).select().single();
        if (error) return err(res, error.message, 500);
        return ok(res, data);
      }
      if (req.method === 'DELETE') {
        if (!id) return err(res, 'id 필수');
        await supabase.from('sep_rules').delete().eq('id', id);
        return ok(res, { id });
      }
    }

    // ════ MAPPING ════
    if (action === 'mapping') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('sep_mapping')
          .select('*').eq('pharma_id', query.pharma_id).order('id');
        if (error) return err(res, error.message, 500);
        return ok(res, data || []);
      }
      if (req.method === 'DELETE') {
        await supabase.from('sep_mapping').delete().eq('pharma_id', query.pharma_id);
        return ok(res, {});
      }
    }

    // ════ MAPPING UPLOAD (multipart) ════
    if (action === 'mapping_upload' && req.method === 'POST') {
      const file = Array.isArray(body._files?.file) ? body._files.file[0] : body._files?.file;
      if (!file) return err(res, '파일이 없습니다');
      const pid = body.pharma_id;
      if (!pid) return err(res, 'pharma_id 필수');

      const fs = require('fs');
      const buf = fs.readFileSync(file.filepath);
      const wb = XLSX.read(buf, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      // 헤더 행 탐지 (정산처 포함 행)
      let headerRow = 0;
      for (let i = 0; i < Math.min(20, rows.length); i++) {
        const cells = rows[i].map(c => String(c).trim());
        if (cells.some(c => c.includes('정산처'))) { headerRow = i; break; }
      }

      const headers = rows[headerRow].map(c => String(c).trim());
      const idxHospital = headers.findIndex(h => ['병원명','처방처명','처방처','거래처명','기관명','키값'].some(k => h.includes(k)));
      const idxBizNo    = headers.findIndex(h => h.includes('사업자번호'));
      const idxPharma   = headers.findIndex(h => h.includes('제약회사') || h.includes('제약사'));
      const idxSettle   = headers.findIndex(h => h.includes('정산처'));
      if (idxSettle === -1) return err(res, '정산처 컬럼을 찾을 수 없습니다');

      const dataRows = rows.slice(headerRow + 1).filter(r => r.some(c => c !== '' && c != null));

      // 기존 매핑 삭제 후 새로 삽입
      await supabase.from('sep_mapping').delete().eq('pharma_id', parseInt(pid));

      const batch = [];
      for (const row of dataRows) {
        const settle = String(row[idxSettle] ?? '').trim();
        if (!settle) continue;
        batch.push({
          pharma_id: parseInt(pid),
          hospital_name: idxHospital >= 0 ? String(row[idxHospital] ?? '').trim() : '',
          biz_no:        idxBizNo    >= 0 ? cleanBizNo(row[idxBizNo])              : '',
          pharma_company: idxPharma  >= 0 ? String(row[idxPharma]  ?? '').trim()  : '',
          settle_org: settle
        });
      }

      const BATCH = 500;
      for (let i = 0; i < batch.length; i += BATCH) {
        const { error } = await supabase.from('sep_mapping').insert(batch.slice(i, i + BATCH));
        if (error) return err(res, error.message, 500);
      }

      return ok(res, { count: batch.length });
    }

    // ════ MAPPING ADD ════
    if (action === 'mapping_add' && req.method === 'POST') {
      const { pharma_id, hospital_name, biz_no, settle_org } = body;
      if (!pharma_id || !settle_org) return err(res, 'pharma_id, settle_org 필수');
      const { error } = await supabase.from('sep_mapping').insert({
        pharma_id: parseInt(pharma_id),
        hospital_name: hospital_name || '',
        biz_no: cleanBizNo(biz_no) || '',
        settle_org
      });
      if (error) return err(res, error.message, 500);
      return ok(res, {});
    }

    // ════ RUN SEPARATION ════
    if (action === 'run' && req.method === 'POST') {
      const { pharma_id, upload_id } = body;
      if (!pharma_id || !upload_id) return err(res, 'pharma_id, upload_id 필수');

      const { data: dataRows } = await supabase.from('cso_upload_data')
        .select('data_json').eq('upload_id', upload_id).eq('pharma_id', pharma_id).order('row_index');
      if (!dataRows?.length) return err(res, '업로드 데이터가 없습니다');

      const { data: mappings } = await supabase.from('sep_mapping')
        .select('*').eq('pharma_id', pharma_id);
      if (!mappings?.length) return err(res, '매핑 파일이 없습니다. 먼저 매핑 파일을 업로드하세요');

      const results = dataRows
        .map(r => JSON.parse(r.data_json))
        .filter(row => !isSkipRow(row, null))
        .map(row => {
          const { settle_org, matched_by } = separateByMapping(row, mappings);
          const { _raw, ...cleanRow } = row;
          return { ...cleanRow, _settle_org: settle_org, _matched_by: matched_by };
        });

      const grouped = {};
      for (const r of results) {
        const org = r._settle_org || '미분류';
        if (!grouped[org]) grouped[org] = [];
        grouped[org].push(r);
      }

      const totalAmt = results.reduce((s, r) => s + (r.amount || 0), 0);
      const summary = Object.entries(grouped).map(([org, rows]) => {
        const amt = rows.reduce((s, r) => s + (r.amount || 0), 0);
        return { settle_org: org, count: rows.length, amount: amt, pct: totalAmt > 0 ? (amt / totalAmt * 100).toFixed(1) : 0 };
      }).sort((a, b) => b.amount - a.amount);

      return ok(res, { results, grouped, summary, total: results.length, unclassified: (grouped['미분류'] || []).length });
    }

    // ════ DOWNLOAD ════
    if (action === 'download' && req.method === 'GET') {
      const { pharma_id, upload_id } = query;

      const { data: hist } = await supabase.from('cso_upload_history').select('header_json').eq('id', upload_id).single();
      const headerArr = hist?.header_json ? JSON.parse(hist.header_json) : null;

      const { data: dataRows } = await supabase.from('cso_upload_data')
        .select('data_json').eq('upload_id', upload_id).eq('pharma_id', pharma_id).order('row_index');
      const { data: mappings } = await supabase.from('sep_mapping').select('*').eq('pharma_id', pharma_id);

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
        const orgSheets = Object.entries(grouped)
          .filter(([org]) => org !== '미분류')
          .map(([name, rows]) => ({ name, rows }));
        if (grouped['미분류']?.length) orgSheets.push({ name: '미분류', rows: grouped['미분류'] });
        buf = buildSeparationExcel(orgSheets, headerArr, null);
      } else {
        const sheets = Object.entries(grouped).map(([org, rows]) => ({
          name: org.slice(0, 31),
          data: rows.map(r => { const o = buildOutputRow(r, headerArr); o['정산처'] = org; return o; })
        }));
        buf = buildExcel(sheets);
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="separation.xlsx"');
      return res.send(buf);
    }

    return err(res, 'Method not allowed', 405);
  } catch(e) {
    return err(res, e.message, 500);
  }
}
