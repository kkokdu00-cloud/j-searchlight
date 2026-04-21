// Modal state
let modalData = [];
let currentIngdNm = '';

// ===================== OPEN INGREDIENT POPUP =====================

async function openIngredientPopup(row) {
  const ingdCd = row.ingdCd;
  if (!ingdCd || ingdCd === '0') {
    showAlert('searchAlert', '이 제품의 성분코드(ingdCd) 정보가 없습니다.', 'info');
    return;
  }

  const modal = document.getElementById('ingredientModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalAlert = document.getElementById('modalAlert');

  // Reset state
  modalData = [];
  modalBody.innerHTML = '';
  modalAlert.style.display = 'none';

  modal.classList.add('active');
  showLoading();

  try {
    console.log('fetch 시작, ingdCd:', ingdCd, '| ingdNm:', row.ingdNm);
    const response = await fetch(`/api/drugs/ingredients/${encodeURIComponent(ingdCd)}?itmNm=${encodeURIComponent(row.ingdNm || '')}`);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || '성분 조회 중 오류가 발생했습니다.');
    }

    currentIngdNm = result.gnlNm || row.ingdCd;
    modalTitle.textContent = `동일성분 의약품 목록 - ${currentIngdNm}`;

    const diseaseSection = document.getElementById('diseaseCodesSection');
    const diseaseCodes = result.diseaseCodes || [];
    if (diseaseSection) {
      if (diseaseCodes.length > 0) {
        const tags = diseaseCodes.map(d =>
          `<span class="disease-tag ${d.is_primary ? 'disease-primary' : ''}" title="${escHtmlModal(d.kcd_name)}">${escHtmlModal(d.kcd_code)} ${escHtmlModal(d.kcd_name)}</span>`
        ).join('');
        diseaseSection.innerHTML = `<div class="disease-codes-wrap"><span class="disease-label">적응증</span>${tags}</div>`;
        diseaseSection.style.display = 'block';
      } else {
        diseaseSection.style.display = 'none';
      }
    }

    modalData = result.data || [];

    const commissionChecked = document.getElementById('commissionFilter')?.checked || false;
    const displayData = commissionChecked ? modalData.filter(d => d.commissionRate > 0) : modalData;
    renderModalTable(displayData);

    if (modalData.length === 0) {
      showModalAlert('동일성분 의약품이 없습니다.', 'info');
    }
  } catch (err) {
    showModalAlert('오류: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ===================== RENDER MODAL TABLE =====================

function renderModalTable(data) {
  const tbody = document.getElementById('modalBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="empty-state" style="padding:24px;">
            <p>데이터가 없습니다.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  data.forEach((row, idx) => {
    const rateNum = parseFloat(row.commissionRate) || 0;
    let rateClass = 'rate-low';
    if (rateNum >= 10) rateClass = 'rate-high';
    else if (rateNum >= 5) rateClass = 'rate-med';

    const bioBadge = row.isBioequivalence
      ? '<span class="badge badge-bio" title="식약처 생동성 인정품목">생동성</span>'
      : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td class="td-left">${escHtmlModal(row.cpnyNm)}</td>
      <td class="td-left">${escHtmlModal(row.itmNm)}${bioBadge ? ' ' + bioBadge : ''}</td>
      <td class="text-right">${row.clsgAmt > 0 ? formatNumberModal(row.clsgAmt) : '<span style="color:#adb5bd;">비급여</span>'}</td>
      <td class="${rateClass}">${rateNum > 0 ? parseFloat(rateNum).toFixed(2) + '%' : '<span style="color:#adb5bd;">-</span>'}</td>
      <td class="text-right">${rateNum > 0 ? formatNumberModal(row.commissionAmt) : '<span style="color:#adb5bd;">-</span>'}</td>
      <td>${escHtmlModal(row.itmCd)}</td>
      <td>${escHtmlModal(row.mnfSeq)}</td>
      <td>${bioBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ===================== CLOSE MODAL =====================

function closeModal() {
  const modal = document.getElementById('ingredientModal');
  modal.classList.remove('active');
  modalData = [];
  currentIngdNm = '';
}

// Close modal when clicking backdrop
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('ingredientModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
});

// ===================== MODAL EXCEL DOWNLOAD =====================

function downloadModalExcel() {
  if (!modalData || modalData.length === 0) {
    alert('다운로드할 데이터가 없습니다.');
    return;
  }

  const ingdLabel = currentIngdNm || '동일성분';
  downloadExcel(modalData, `동일성분_${ingdLabel}`);
}

// ===================== MODAL ALERT =====================

function showModalAlert(message, type = 'error') {
  const el = document.getElementById('modalAlert');
  if (!el) return;
  el.style.display = 'block';
  const cls = type === 'error' ? 'alert-error' : type === 'success' ? 'alert-success' : 'alert-info';
  el.innerHTML = `<div class="alert ${cls}">${message}</div>`;
}

// ===================== UTILITY (mirrored for popup) =====================

function formatNumberModal(n) {
  if (n === null || n === undefined || n === '') return '-';
  const num = parseFloat(n);
  if (isNaN(num)) return '-';
  return num.toLocaleString('ko-KR');
}

function escHtmlModal(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
