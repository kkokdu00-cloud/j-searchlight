'use strict';

const formidable = require('formidable');
const XLSX = require('xlsx');
const { supabase, ok, err, setCors, requireAuth,
        detectColumns, transformRow, safeDecodeFileName, buildExcel, buildOutputRow } = require('./_utils');

export const config = { api: { bodyParser: false } };

async function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: 50 * 1024 * 1024 });
    form.parse(req, (e, fields, files) => {
      if (e) reject(e);
      else resolve({ fields, files });
    });
  });
}

// GET    /api/cso/upload?action=history&pharma_id=
// GET    /api/cso/upload?action=data&id=
// GET    /api/cso/upload?action=download&id=
// POST   /api/cso/upload?action=detect
// POST   /api/cso/upload?action=save
// DELETE /api/cso/upload?id=

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  const { action, id, pharma_id } = req.query;

  try {
    // ── 업로드 이력 조회
    if (req.method === 'GET' && action === 'history') {
      let q = supabase.from('cso_upload_history').select('*').order('id', { ascending: false });
      if (pharma_id) q = q.eq('pharma_id', pharma_id);
      else q = q.limit(100);
      const { data, error } = await q;
      if (error) return err(res, error.message, 500);
      return ok(res, data || []);
    }

    // ── 업로드 데이터 조회
    if (req.method === 'GET' && action === 'data') {
      if (!id) return err(res, 'id 필수');
      const { data, error } = await supabase.from('cso_upload_data')
        .select('data_json,row_index').eq('upload_id', id).order('row_index');
      if (error) return err(res, error.message, 500);
      return ok(res, (data || []).map(r => JSON.parse(r.data_json)));
    }

    // ── 다운로드
    if (req.method === 'GET' && action === 'download') {
      if (!id) return err(res, 'id 필수');
      const { data: hist } = await supabase.from('cso_upload_history').select('*').eq('id', id).single();
      if (!hist) return err(res, '업로드 없음', 404);
      const { data: rows } = await supabase.from('cso_upload_data')
        .select('data_json').eq('upload_id', id).order('row_index');
      const headerArr = hist.header_json ? JSON.parse(hist.header_json) : null;
      const data = (rows || []).map(r => buildOutputRow(JSON.parse(r.data_json), headerArr));
      const buf = buildExcel([{ name: '데이터', data }]);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(hist.file_name + '_변환.xlsx')}`);
      return res.send(buf);
    }

    // ── 파일 감지 (컬럼 자동 인식)
    if (req.method === 'POST' && action === 'detect') {
      const { fields, files } = await parseForm(req);
      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!file) return err(res, '파일이 없습니다');
      const fileType = (Array.isArray(fields.file_type) ? fields.file_type[0] : fields.file_type) || 'prescription';
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

    // ── 파일 저장
    if (req.method === 'POST' && action === 'save') {
      const { fields, files } = await parseForm(req);
      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!file) return err(res, '파일이 없습니다');

      const fv = (k) => Array.isArray(fields[k]) ? fields[k][0] : fields[k];
      const pid = fv('pharma_id');
      if (!pid) return err(res, 'pharma_id 필수');

      const fileType = fv('file_type') || 'prescription';
      const headerRowParam = parseInt(fv('header_row') || '0');
      const refMonth = fv('ref_month') || '';
      const columnMapJson = fv('column_map_json');

      const fs = require('fs');
      const buf = fs.readFileSync(file.filepath);
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      let columnMap;
      if (columnMapJson) {
        columnMap = JSON.parse(columnMapJson);
      } else {
        const detected = detectColumns(rows, fileType);
        columnMap = detected.columnMap;
      }

      const startRow = headerRowParam + 1;
      const headerRowArr = rows[startRow - 1] || [];
      const headerJson = JSON.stringify(headerRowArr.map(h => String(h || '').trim()));
      const dataRows = rows.slice(startRow).filter(r => r.some(c => c !== '' && c != null));
      const fileName = safeDecodeFileName(file.originalFilename || file.newFilename);

      const { data: hist, error: histErr } = await supabase.from('cso_upload_history')
        .insert({
          pharma_id: parseInt(pid), file_type: fileType, file_name: fileName,
          ref_month: refMonth, row_count: dataRows.length,
          column_map: JSON.stringify(columnMap), header_json: headerJson
        }).select().single();
      if (histErr) return err(res, histErr.message, 500);

      const uploadId = hist.id;

      // 배치 삽입 (Supabase는 한번에 최대 1000행)
      const BATCH = 500;
      for (let i = 0; i < dataRows.length; i += BATCH) {
        const batch = dataRows.slice(i, i + BATCH).map((row, j) => {
          const transformed = transformRow(row, columnMap, fileType);
          transformed._raw = row;
          return {
            upload_id: uploadId,
            pharma_id: parseInt(pid),
            row_index: i + j,
            data_json: JSON.stringify(transformed)
          };
        });
        const { error: batchErr } = await supabase.from('cso_upload_data').insert(batch);
        if (batchErr) return err(res, batchErr.message, 500);
      }

      return ok(res, { upload_id: uploadId, row_count: dataRows.length, file_name: fileName });
    }

    // ── 삭제
    if (req.method === 'DELETE') {
      if (!id) return err(res, 'id 필수');
      await supabase.from('cso_upload_data').delete().eq('upload_id', id);
      await supabase.from('cso_upload_history').delete().eq('id', id);
      return ok(res, { id });
    }

    return err(res, 'Method not allowed', 405);
  } catch(e) {
    return err(res, e.message, 500);
  }
}
