// Global state
let currentData = [];
let allDrugs = [];

// ===================== UTILITY =====================

function formatNumber(n) {
  if (n === null || n === undefined || n === '') return '-';
  const num = parseFloat(n);
  if (isNaN(num)) return '-';
  return num.toLocaleString('ko-KR');
}

function formatRate(r) {
  if (r === null || r === undefined) return '-';
  const num = parseFloat(r);
  if (isNaN(num)) return '-';
  return num.toFixed(2);
}

function showAlert(containerId, message, type = 'error') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `<div class="alert alert-${type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'}">${message}</div>`;
}

function hideAlert(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.style.display = 'none';
}

function showLoading() {
  document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('active');
}

// ===================== SEARCH =====================

async function searchDrugs() {
  hideAlert('searchAlert');

  const keyword = document.getElementById('searchInput').value.trim();
  if (!keyword) {
    showAlert('searchAlert', '검색어를 입력하세요', 'error');
    return;
  }

  const searchType = document.querySelector('input[name="searchType"]:checked').value;
  const bioFilter = document.getElementById('bioFilter')?.checked || false;

  showLoading();

  try {
    const params = new URLSearchParams({ searchType, keyword });
    if (bioFilter) params.set('bioequivalence', 'true');

    const response = await fetch(`/api/drugs/search?${params}`);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || '검색 중 오류가 발생했습니다.');
    }

    allDrugs = result.allDrugs || result.data || [];
    applyFilters();

    if (currentData.length === 0) {
      showAlert('searchAlert', '검색 결과가 없습니다.', 'info');
    }
  } catch (err) {
    showAlert('searchAlert', '오류: ' + err.message, 'error');
    currentData = [];
    allDrugs = [];
    renderTable([]);
  } finally {
    hideLoading();
  }
}

// Enter key search
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('searchInput');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchDrugs();
    });
  }
});

// ===================== FILTERS =====================

function applyFilters() {
  const bioChecked        = document.getElementById('bioFilter')?.checked || false;
  const priceChecked      = document.getElementById('priceFilter')?.checked || false;
  const commissionChecked = document.getElementById('commissionFilter')?.checked || false;

  let filtered = [...allDrugs];

  // 생동성 필터
  if (bioChecked) {
    filtered = filtered.filter(d => d.isBioequivalence);
  }

  // 약가유지(자체생동+DMF) 필터
  if (priceChecked) {
    filtered = filtered.filter(d => d.priceEvalResult === '약가유지');
  }

  // 수수료 등록 품목 필터
  if (commissionChecked) {
    filtered = filtered.filter(d => d.commissionRate > 0);
  }

  currentData = filtered;
  renderTable(currentData);

  if (currentData.length === 0 && allDrugs.length > 0) {
    showAlert('searchAlert', '필터 조건에 맞는 품목이 없습니다.', 'info');
  } else {
    hideAlert('searchAlert');
  }
}

// ===================== RENDER TABLE =====================

function renderTable(data) {
  const tbody = document.getElementById('resultsBody');
  const resultCount = document.getElementById('resultCount');
  const resultsSection = document.getElementById('resultsSection');
  const emptyState = document.getElementById('emptyState');

  if (!tbody) return;

  resultCount.textContent = data.length;

  if (data.length === 0) {
    resultsSection.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>검색 결과가 없습니다.</p>
        <p style="margin-top:6px; font-size:12px; color:#adb5bd;">다른 검색어로 다시 시도하세요.</p>
      </div>
    `;
    return;
  }

  emptyState.style.display = 'none';
  resultsSection.style.display = 'block';

  tbody.innerHTML = '';

  data.forEach((row, idx) => {
    const rateNum = parseFloat(row.commissionRate) || 0;
    let rateClass = 'rate-low';
    if (rateNum >= 10) rateClass = 'rate-high';
    else if (rateNum >= 5) rateClass = 'rate-med';

    // 생동성 뱃지
    const bioBadge = row.isBioequivalence
      ? '<span class="badge badge-bio" title="생물학적 동등성 인정품목">생동성</span>'
      : '';

    // 약가유지 뱃지 (자체생동+DMF 충족)
    const priceOkBadge = row.priceEvalResult === '약가유지'
      ? '<span class="badge badge-price-ok" title="자체생동+DMF 충족 약가유지 품목">약가유지</span>'
      : (row.priceEvalResult === '약가인하'
        ? '<span class="badge badge-price-down" title="기준 미충족 약가인하 품목">약가인하</span>'
        : '');

    const tr = document.createElement('tr');
    tr.className = 'double-click-hint';
    tr.title = '더블클릭: 동일성분 제약사 조회';
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td class="td-left">${escHtml(row.cpnyNm)}</td>
      <td class="td-left">${escHtml(row.itmNm)}${bioBadge ? ' ' + bioBadge : ''}</td>
      <td class="td-left">${escHtml(row.ingdNm) || '<span style="color:#adb5bd;">-</span>'}</td>
      <td class="text-right">${formatNumber(row.clsgAmt)}</td>
      <td class="${rateClass}">${rateNum > 0 ? formatRate(rateNum) + '%' : '<span style="color:#adb5bd;">-</span>'}</td>
      <td class="text-right">${rateNum > 0 ? formatNumber(row.commissionAmt) : '<span style="color:#adb5bd;">-</span>'}</td>
      <td>${escHtml(row.itmCd)}</td>
      <td>${escHtml(row.mnfSeq)}</td>
      <td>${bioBadge} ${priceOkBadge}</td>
    `;

    tr.addEventListener('dblclick', () => {
      if (row.ingdCd && row.ingdCd !== '0') {
        openIngredientPopup(row);
      } else {
        showAlert('searchAlert', '이 제품은 성분코드(ingdCd) 정보가 없습니다.', 'info');
      }
    });

    tbody.appendChild(tr);
  });
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===================== EXCEL DOWNLOAD =====================

function downloadExcel(data, filename) {
  if (!data || data.length === 0) {
    alert('다운로드할 데이터가 없습니다.');
    return;
  }

  const headers = ['번호', '제약사', '제품명', '성분명', '보험가(원)', '수수료율(%)', '수수료환산(원)', '제품코드', '표준코드', '약가평가'];

  const rows = data.map((row, idx) => [
    idx + 1,
    row.cpnyNm || '',
    row.itmNm || '',
    row.ingdNm || '',
    parseFloat(row.clsgAmt) || 0,
    parseFloat(row.commissionRate) || 0,
    parseFloat(row.commissionAmt) || 0,
    row.itmCd || '',
    row.mnfSeq || '',
    row.priceEvalResult || ''
  ]);

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws['!cols'] = [
    { wch: 6 }, { wch: 20 }, { wch: 30 }, { wch: 24 },
    { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 12 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '의약품목록');

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  XLSX.writeFile(wb, `${filename}_${dateStr}.xlsx`);
}