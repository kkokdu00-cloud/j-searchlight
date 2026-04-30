'use strict';

const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');

const JWT_SECRET = process.env.JWT_SECRET || 'jsearchlight-jwt-secret';

// ── Supabase 클라이언트 (pharma-drug-search 프로젝트)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── 응답 헬퍼
const ok  = (res, data) => res.json({ ok: true, data });
const err = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

// ── CORS 헤더
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ── JWT 인증 미들웨어
function requireAuth(req, res) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    err(res, '인증이 필요합니다', 401);
    return null;
  }
  try {
    return jwt.verify(header.slice(7), JWT_SECRET);
  } catch(e) {
    err(res, '유효하지 않은 토큰입니다', 401);
    return null;
  }
}

// ── Supabase PostgreSQL 헬퍼 (체크메이트 테이블은 모두 cso_ 접두사)
const db = {
  async all(sql, params = []) {
    const { data, error } = await supabase.rpc('exec_sql', { query: sql, params });
    if (error) throw new Error(error.message);
    return data || [];
  },

  // Supabase 직접 테이블 접근 헬퍼
  from: (table) => supabase.from(table),

  // 범용 쿼리 (Supabase postgrest 방식)
  async query(table, options = {}) {
    let q = supabase.from(table).select(options.select || '*');
    if (options.eq)     Object.entries(options.eq).forEach(([k,v])   => { q = q.eq(k, v); });
    if (options.order)  q = q.order(options.order.col, { ascending: options.order.asc ?? true });
    if (options.limit)  q = q.limit(options.limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  },

  async insert(table, row) {
    const { data, error } = await supabase.from(table).insert(row).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async update(table, updates, eq) {
    let q = supabase.from(table).update(updates);
    Object.entries(eq).forEach(([k,v]) => { q = q.eq(k, v); });
    const { data, error } = await q.select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async delete(table, eq) {
    let q = supabase.from(table).delete();
    Object.entries(eq).forEach(([k,v]) => { q = q.eq(k, v); });
    const { error } = await q;
    if (error) throw new Error(error.message);
  },

  async upsert(table, row, onConflict) {
    const { data, error } = await supabase.from(table).upsert(row, { onConflict }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }
};

// ── 컬럼 별칭
const ALIASES = {
  prescription: {
    prescription_month: ['처방월','처방년월','처방일자','처방날짜','처방기간','년월','기준월','적용월','처방년도'],
    hospital_name: ['처방처명','처방처','요양기관명','기관명','병원명','병의원명','의원명','거래처명','거래처','요양기관','병의원','기관','병원'],
    biz_no: ['사업자번호','사업자등록번호','요양기관번호','기관번호','사업자번호(10자리)','사업자'],
    ins_code: ['보험코드','주성분코드','보험약코드','급여코드','보험청구코드','약코드','보험품목코드'],
    product_name: ['제품명','품목명','약품명','의약품명','품명','제품','약품','상품명'],
    quantity: ['수량','처방수량','조제수량','처방량','처방건수','조제량'],
    amount: ['금액','처방금액','청구금액','매출금액','처방액','합계금액','합계','총금액','처방총액']
  },
  settlement: {
    settle_month: ['정산월','처방월','정산년월','처방년월','정산일자','지급월','기준월','년월','적용월'],
    hospital_name: ['처방처명','처방처','병의원명','요양기관명','기관명','병원명','의원명','거래처명','거래처','요양기관','기관','병원'],
    biz_no: ['사업자번호','사업자등록번호','요양기관번호','기관번호','사업자번호(10자리)','사업자'],
    ins_code: ['보험코드','주성분코드','보험약코드','급여코드','보험청구코드','약코드'],
    product_name: ['제품명','품목명','약품명','의약품명','품명','제품','약품'],
    quantity: ['수량','처방수량','조제수량','처방량'],
    amount: ['금액','처방금액','청구금액','매출금액','정산금액','합계금액','합계','총금액'],
    settle_org: ['정산처','영업처','담당처','대리점','딜러','거래처','배분처','영업소']
  }
};

// ── 유틸 함수
function cleanBizNo(v) {
  if (v == null) return '';
  return String(v).replace(/[^0-9]/g, '');
}

function parseAmount(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0;
}

function parseQty(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v);
  return parseInt(String(v).replace(/[^0-9]/g, '')) || 0;
}

function parseDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(v);
      if (d) return `${d.y}-${String(d.m).padStart(2,'0')}`;
    } catch(e) {}
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[\/\-\.\s](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}`;
  m = s.match(/^(\d{4})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  return s;
}

function detectColumns(rows, fileType) {
  const aliases = ALIASES[fileType] || ALIASES.prescription;
  let bestRow = 0, bestScore = -1;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const cells = (rows[i] || []).map(c => String(c || '').trim().toLowerCase());
    let score = 0;
    for (const [, aliasList] of Object.entries(aliases)) {
      if (aliasList.some(a => cells.includes(a.toLowerCase()))) score++;
    }
    if (score > bestScore) { bestScore = score; bestRow = i; }
  }
  const header = rows[bestRow] || [];
  const columnMap = {}, confidence = {};
  for (const [field, aliasList] of Object.entries(aliases)) {
    let found = false;
    for (let i = 0; i < header.length; i++) {
      const cell = String(header[i] || '').trim();
      if (aliasList.some(a => a.toLowerCase() === cell.toLowerCase())) {
        columnMap[field] = i; confidence[field] = 'high'; found = true; break;
      }
    }
    if (!found) {
      for (let i = 0; i < header.length; i++) {
        const cell = String(header[i] || '').trim().toLowerCase();
        if (cell && aliasList.some(a => cell.includes(a.toLowerCase()) || a.toLowerCase().includes(cell))) {
          columnMap[field] = i; confidence[field] = 'medium'; found = true; break;
        }
      }
    }
    if (!found) confidence[field] = 'low';
  }
  return {
    headerRow: bestRow, columnMap, confidence, score: bestScore,
    totalFields: Object.keys(aliases).length,
    allHeaders: header.map((h, i) => ({ index: i, value: String(h || '').trim() })).filter(h => h.value)
  };
}

function transformRow(rawRow, columnMap, fileType) {
  const r = {};
  for (const [field, colIdx] of Object.entries(columnMap)) {
    if (colIdx == null) continue;
    const raw = rawRow[colIdx];
    if (field === 'biz_no') r.biz_no = cleanBizNo(raw);
    else if (field === 'amount') r.amount = parseAmount(raw);
    else if (field === 'quantity') r.quantity = parseQty(raw);
    else if (field === 'prescription_month' || field === 'settle_month') r.prescription_month = parseDate(raw);
    else r[field] = raw != null ? String(raw).trim() : '';
  }
  return r;
}

function normalizeName(v) {
  return String(v || '').replace(/[\s\(\)\[\]·・\.]/g, '').toLowerCase();
}

function separateByMapping(row, mappings) {
  const bizNo = cleanBizNo(row.biz_no);
  const hospitalName = (row.hospital_name || '').trim();

  // 1) 사업자번호 완전일치
  if (bizNo) {
    const m = mappings.find(m => m.biz_no && cleanBizNo(m.biz_no) === bizNo);
    if (m) return { settle_org: m.settle_org, matched_by: 'biz_no' };
  }

  if (hospitalName) {
    const normRow = normalizeName(hospitalName);

    // 2) 병원명 완전일치 (정규화 후)
    const m1 = mappings.find(m => m.hospital_name && normalizeName(m.hospital_name) === normRow);
    if (m1) return { settle_org: m1.settle_org, matched_by: 'hospital_name_exact' };

    // 3) 병원명 부분일치 (데이터 ⊃ 매핑키 or 매핑키 ⊃ 데이터)
    const m2 = mappings.find(m => {
      if (!m.hospital_name) return false;
      const normMap = normalizeName(m.hospital_name);
      return normRow.includes(normMap) || normMap.includes(normRow);
    });
    if (m2) return { settle_org: m2.settle_org, matched_by: 'hospital_name_partial' };
  }

  return { settle_org: '미분류', matched_by: null };
}

function isSkipRow(row, config) {
  if (config?.subtotal_detect) {
    const d = config.subtotal_detect;
    if (d.biz_no_null      && cleanBizNo(row.biz_no))            return false;
    if (d.hospital_name_null && (row.hospital_name || '').trim()) return false;
    if (d.product_name_null  && (row.product_name  || '').trim()) return false;
    return true;
  }
  if ((row.settle_org || '').trim()) return false;
  return !cleanBizNo(row.biz_no) && !(row.hospital_name || '').trim();
}

function buildOutputRow(row, headerArr) {
  if (headerArr && row._raw) {
    const r = {};
    for (let i = 0; i < headerArr.length; i++) {
      if (headerArr[i]) r[headerArr[i]] = row._raw[i] !== undefined ? row._raw[i] : '';
    }
    return r;
  }
  const { _raw, ...rest } = row;
  return rest;
}

function safeDecodeFileName(name) {
  try {
    let s = name || '';
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    }
    return s;
  } catch { return name || ''; }
}

function calcSettlement(totalFee, formula) {
  if (!formula) return Math.round(totalFee * 1.1);
  const m = formula.match(/total_commission\s*\*\s*([\d.]+)/);
  return m ? Math.round(totalFee * parseFloat(m[1])) : Math.round(totalFee * 1.1);
}

function buildSeparationExcel(orgSheets, headerArr, config) {
  const wb = XLSX.utils.book_new();
  const n = headerArr.length;
  function findIdx(...keys) {
    for (const k of keys) { const i = headerArr.indexOf(k); if (i >= 0) return i; }
    for (const k of keys) { const i = headerArr.findIndex(h => h.includes(k)); if (i >= 0) return i; }
    return -1;
  }
  const idxQty = findIdx(...(config?.excel_columns?.qty    || ['수량', '처방수량']));
  const idxAmt = findIdx(...(config?.excel_columns?.amount || ['금액(V+)', '금액', '처방금액']));
  const idxFee = findIdx(...(config?.excel_columns?.fee    || ['수수료금액(V-)', '수수료금액']));
  const row2Left  = config?.output_header?.row2_left  || '수수료 정산내역';
  const row2Right = config?.output_header?.row2_right || '※ 수수료율, 수수료금액은 부가세 별도입니다.';
  function toNum(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    return parseFloat(String(v).replace(/,/g, '')) || 0;
  }
  function blank() { return Array(n).fill(''); }
  function safeName(s) { return String(s).replace(/[\/\\?*[\]:]/g, '_').slice(0, 31); }
  for (const { name, rows } of orgSheets) {
    const isMissed = name === '미분류';
    const aoa = [];
    aoa.push(blank());
    const r2 = blank();
    r2[0] = row2Left;
    if (n > 1) r2[1] = row2Right;
    aoa.push(r2);
    aoa.push([...headerArr]);
    let totalQty = 0, totalAmt = 0, totalFee = 0;
    let curKey = null, hQty = 0, hAmt = 0, hFee = 0;
    const pushSubtotal = () => {
      const sr = blank();
      sr[0] = '소  계';
      if (idxQty >= 0) sr[idxQty] = hQty;
      if (idxAmt >= 0) sr[idxAmt] = hAmt;
      if (idxFee >= 0) sr[idxFee] = hFee;
      aoa.push(sr);
      hQty = 0; hAmt = 0; hFee = 0;
    };
    for (const row of rows) {
      const key = row.biz_no || row.hospital_name || '';
      if (!isMissed && curKey !== null && key !== curKey) pushSubtotal();
      curKey = key;
      const dr = blank();
      if (row._raw) {
        for (let i = 0; i < Math.min(row._raw.length, n); i++) dr[i] = row._raw[i] != null ? row._raw[i] : '';
      } else {
        headerArr.forEach((h, i) => { dr[i] = row[h] ?? ''; });
      }
      aoa.push(dr);
      const qty = toNum(idxQty >= 0 ? (row._raw?.[idxQty] ?? row.quantity) : row.quantity);
      const amt = toNum(idxAmt >= 0 ? (row._raw?.[idxAmt] ?? row.amount)   : row.amount);
      const fee = toNum(idxFee >= 0 ? row._raw?.[idxFee] : 0);
      hQty += qty; hAmt += amt; hFee += fee;
      totalQty += qty; totalAmt += amt; totalFee += fee;
    }
    if (!isMissed && curKey !== null) pushSubtotal();
    if (!isMissed && rows.length > 0) {
      const tr = blank(); tr[0] = '총    계';
      if (idxQty >= 0) tr[idxQty] = totalQty;
      if (idxAmt >= 0) tr[idxAmt] = totalAmt;
      if (idxFee >= 0) tr[idxFee] = totalFee;
      aoa.push(tr);
      const pr = blank(); pr[0] = '정산금액';
      if (idxFee >= 0) pr[idxFee] = calcSettlement(totalFee, config?.settlement_calc);
      aoa.push(pr);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), safeName(name));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function buildExcel(sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, data } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  supabase, db, ok, err, setCors, requireAuth, JWT_SECRET,
  ALIASES, cleanBizNo, parseAmount, parseQty, parseDate,
  detectColumns, transformRow, separateByMapping, isSkipRow,
  buildOutputRow, safeDecodeFileName, buildSeparationExcel, buildExcel
};
