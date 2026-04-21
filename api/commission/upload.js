const { createClient } = require('@supabase/supabase-js');
const xlsx = require('xlsx');
const formidable = require('formidable');
const fs = require('fs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
    const [, files] = await form.parse(req);
    const file = files.file?.[0];

    if (!file) {
      return res.status(400).json({ error: '파일을 선택하세요.' });
    }

    const buffer = fs.readFileSync(file.filepath);
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: '엑셀 파일에 데이터가 없습니다.' });
    }

    const seen = new Set();
    const records = [];
    for (const row of rows) {
      const standardCode = String(row['보험코드'] || row['표준코드'] || row['standard_code'] || '').trim();
      const commissionRate = parseFloat(row['수수료율(%)'] || row['commission_rate'] || 0);

      if (!standardCode || standardCode === '-' || !/^\d+$/.test(standardCode)) continue;
      if (seen.has(standardCode)) continue;
      seen.add(standardCode);

      records.push({
        standard_code: standardCode,
        commission_rate: commissionRate,
        updated_at: new Date().toISOString()
      });
    }

    if (records.length === 0) {
      return res.status(400).json({ error: '유효한 데이터가 없습니다. 보험코드와 수수료율(%) 컬럼을 확인하세요.' });
    }

    const { error } = await supabase
      .from('drug_commission')
      .upsert(records, { onConflict: 'standard_code' });

    if (error) {
      console.error('Supabase upsert error:', error);
      return res.status(500).json({ error: 'DB 저장 중 오류가 발생했습니다: ' + error.message });
    }

    res.json({ success: true, count: records.length, message: `${records.length}건이 업데이트되었습니다.` });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: '업로드 처리 중 오류가 발생했습니다.' });
  }
};

handler.config = { api: { bodyParser: false } };

module.exports = handler;
