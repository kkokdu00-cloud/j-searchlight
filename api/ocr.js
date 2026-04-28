export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType, pharmaName, productList } = req.body;
  if (!imageBase64 || !mediaType) {
    return res.status(400).json({ error: 'imageBase64, mediaType 필요' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  const isPdf = mediaType === 'application/pdf';
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };
  if (isPdf) headers['anthropic-beta'] = 'pdfs-2024-09-25';

  const contentBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
    : { type: 'image',    source: { type: 'base64', media_type: mediaType,          data: imageBase64 } };

  let productHint = '';
  if (pharmaName) productHint = `\n\n[대상 제약사]: ${pharmaName}`;
  if (productList && productList.length > 0) {
    const listStr = productList.slice(0, 50).map(p => `  - ${p.code}${p.name ? ' (' + p.name + ')' : ''}`).join('\n');
    productHint += `\n[등록된 보험코드 목록 - 이 코드가 있는 행만 추출]\n${listStr}`;
  }

  const prompt = `이 이미지는 병의원 EDI 급여청구 내역서입니다.${productHint}

【1단계: 헤더 파싱】
표의 컬럼 헤더 행을 찾아 왼쪽부터 순서대로 각 컬럼명과 위치(1,2,3...)를 파악하라.
아래 규칙으로 각 컬럼을 확정하라:

- "청구코드" 또는 "보험코드" → [CODE]
- "명칭" 또는 "제품명" → [NAME]
- "단가" → [PRICE] ← 앵커 컬럼. 보통 100~9999 범위의 숫자
- "총사용량" 또는 "사용량" → [QTY] ← 단가([PRICE]) 바로 오른쪽 컬럼
- "총금액" → [TOTAL] ← 맨 오른쪽 컬럼, 검증용으로만 사용
- "처방횟수" → [IGNORE] ← 단가([PRICE]) 바로 왼쪽 컬럼, 절대 QTY로 쓰지 말 것
- "사용자코드", "사용자ID", "등록코드" → [IGNORE]
- 헤더명이 불분명하면: 단가 오른쪽 컬럼을 QTY로 확정

【2단계: 데이터 추출】
1단계에서 확정한 컬럼 위치 기준으로 각 행을 읽어라:
- code  = [CODE] 값 (9~13자리 숫자, 없는 행은 건너뜀)
- name  = [NAME] 값 (글자 그대로만, 절대 추론하지 말 것)
- qout  = [QTY] 값 (총사용량, 단가 오른쪽 컬럼)
- total = [TOTAL] 값 (총금액, 검증용)
- qin   = 0 (항상 0)
- price = 0 (항상 0, DB에서 덮어씀)
- type  = 문서에 "외래" 또는 "원외" 있으면 "처방", "원내" 있으면 "조제", 없으면 "처방"

【검증 - 반드시 수행】
추출 후 각 행 확인:
- qout >= 1000 이면 총금액 컬럼을 잘못 읽은 것 → 재확인
- qout 값이 해당 행 단가보다 크면 컬럼 혼동 → 재확인
- 처방횟수([IGNORE]) 값과 qout이 같으면 잘못 매핑 → 단가 오른쪽 컬럼으로 재확인

【출력】
JSON 배열만 출력. 설명 없이, 마크다운 없이.
필드: code, name, price, qin, qout, total, type`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }]
      })
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = (data.content || []).map(c => c.text || '').join('');
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
