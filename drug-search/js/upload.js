// Global state
let selectedFile = null;
let commissionData = [];

// ===================== INIT =====================

document.addEventListener('DOMContentLoaded', () => {
  setupDragDrop();
  loadCommissionList();
});

// ===================== DRAG & DROP =====================

function setupDragDrop() {
  const zone = document.getElementById('uploadZone');
  if (!zone) return;

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
  });
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) setFile(file);
}

function setFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showUploadAlert('엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.', 'error');
    return;
  }

  selectedFile = file;
  hideUploadAlert();

  const fileNameEl = document.getElementById('fileName');
  fileNameEl.textContent = `선택된 파일: ${file.name} (${formatFileSize(file.size)})`;
  fileNameEl.style.display = 'block';

  document.getElementById('uploadBtn').disabled = false;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

// ===================== UPLOAD =====================

async function uploadFile() {
  if (!selectedFile) {
    showUploadAlert('파일을 선택하세요.', 'error');
    return;
  }

  showLoading('업로드 중...');

  const formData = new FormData();
  formData.append('file', selectedFile);

  try {
    const response = await fetch('/api/commission/upload', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || '업로드 중 오류가 발생했습니다.');
    }

    showUploadAlert(`✅ ${result.message || result.count + '건이 업데이트되었습니다.'}`, 'success');

    // Reset file
    selectedFile = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('fileName').style.display = 'none';
    document.getElementById('uploadBtn').disabled = true;

    // Reload list
    loadCommissionList();
  } catch (err) {
    showUploadAlert('오류: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ===================== LOAD COMMISSION LIST =====================

async function loadCommissionList() {
  try {
    const response = await fetch('/api/commission/list');
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || '목록 조회 중 오류가 발생했습니다.');
    }

    commissionData = result.data || [];
    renderCommissionList(commissionData);
  } catch (err) {
    const content = document.getElementById('commissionListContent');
    if (content) {
      content.innerHTML = `
        <div class="empty-state" style="padding:32px 20px;">
          <div class="empty-icon" style="font-size:32px;">⚠️</div>
          <p>목록을 불러오지 못했습니다: ${err.message}</p>
        </div>
      `;
    }
  }
}

function renderCommissionList(data) {
  const content = document.getElementById('commissionListContent');
  const countEl = document.getElementById('listCount');

  if (countEl) {
    countEl.innerHTML = `총 <strong>${data.length}</strong>건`;
  }

  if (!content) return;

  if (data.length === 0) {
    content.innerHTML = `
      <div class="empty-state" style="padding:32px 20px;">
        <div class="empty-icon" style="font-size:32px;">📋</div>
        <p>등록된 수수료율 데이터가 없습니다.</p>
        <p style="margin-top:6px; font-size:12px; color:#adb5bd;">엑셀 파일을 업로드하여 수수료율을 등록하세요.</p>
      </div>
    `;
    return;
  }

  let html = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th style="width:60px;">번호</th>
            <th>보험코드</th>
            <th>수수료율(%)</th>
            <th>최종 수정일</th>
          </tr>
        </thead>
        <tbody>
  `;

  data.forEach((item, idx) => {
    const rateNum = parseFloat(item.commission_rate) || 0;
    let rateClass = 'rate-low';
    if (rateNum >= 10) rateClass = 'rate-high';
    else if (rateNum >= 5) rateClass = 'rate-med';

    const updatedAt = item.updated_at
      ? new Date(item.updated_at).toLocaleString('ko-KR', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit'
        })
      : '-';

    html += `
      <tr>
        <td>${idx + 1}</td>
        <td>${escHtml(item.standard_code)}</td>
        <td class="${rateClass}">${rateNum > 0 ? rateNum.toFixed(2) + '%' : '-'}</td>
        <td style="color:#6c757d; font-size:12px;">${updatedAt}</td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  content.innerHTML = html;
}

// ===================== TEMPLATE DOWNLOAD =====================

function downloadTemplate() {
  const headers = ['보험코드', '수수료율(%)'];
  const sampleRows = [
    ['8800000000001', 10.5],
    ['8800000000002', 7.0],
    ['8800000000003', 15.0]
  ];

  const wsData = [headers, ...sampleRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws['!cols'] = [{ wch: 20 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '수수료율');

  XLSX.writeFile(wb, '수수료율_템플릿.xlsx');
}

// ===================== COMMISSION EXCEL DOWNLOAD =====================

function downloadCommissionExcel() {
  if (!commissionData || commissionData.length === 0) {
    alert('다운로드할 데이터가 없습니다.');
    return;
  }

  const headers = ['번호', '보험코드', '수수료율(%)', '최종 수정일'];
  const rows = commissionData.map((item, idx) => [
    idx + 1,
    item.standard_code || '',
    parseFloat(item.commission_rate) || 0,
    item.updated_at ? new Date(item.updated_at).toLocaleString('ko-KR') : ''
  ]);

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 6 }, { wch: 20 }, { wch: 14 }, { wch: 22 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '수수료율목록');

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  XLSX.writeFile(wb, `수수료율목록_${dateStr}.xlsx`);
}

// ===================== LOADING =====================

function showLoading(text) {
  const overlay = document.getElementById('loadingOverlay');
  const textEl = document.getElementById('loadingText');
  if (overlay) overlay.classList.add('active');
  if (textEl && text) textEl.textContent = text;
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.remove('active');
}

// ===================== ALERTS =====================

function showUploadAlert(message, type) {
  const el = document.getElementById('uploadAlert');
  if (!el) return;
  el.style.display = 'block';
  const cls = type === 'error' ? 'alert-error' : type === 'success' ? 'alert-success' : 'alert-info';
  el.innerHTML = `<div class="alert ${cls}">${message}</div>`;
}

function hideUploadAlert() {
  const el = document.getElementById('uploadAlert');
  if (el) el.style.display = 'none';
}

// ===================== UTILITY =====================

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
