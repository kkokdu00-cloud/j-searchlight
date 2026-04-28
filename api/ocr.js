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

  const prompt = `이 이미지는 병의원 EDI 급여청구 내역서(제약사별 통계)입니다.${productHint}

[추출 규칙]
1. 먼저 표의 컬럼 헤더를 읽어라
   - "청구코드" 또는 "보험코드" → code
   - "총사용량" 또는 "사용량" 또는 "수량" → qout
   - "처방횟수" → 무시 (처방 횟수는 수량이 아님)
   - "단가" → price (참고용)
   - "명칭" 또는 "제품명" → name (이미지 글자 그대로만, 절대 추론 금지)
   - 헤더가 없으면: 보험코드 옆 숫자 중 마지막 큰 숫자가 총사용량

2. 보험코드 추출 (최우선)
   - 9~13자리 숫자
   - 청구코드와 등록코드가 둘 다 있으면 청구코드 사용
   - 코드가 없는 행은 건너뜀

3. 수량
   - qout = 총사용량 컬럼 값
   - qin = 0 (원내 구분 없으면 항상 0)

4. type
   - 헤더 또는 문서에 "외래" 또는 "원외" → "처방"
   - 헤더 또는 문서에 "원내" → "조제"
   - 구분 없으면 "처방"

5. 출력
   - JSON 배열만 출력, 설명 없이
   - 필드: code, name, price, qin, qout, type
   - 숫자에서 콤마 제거, 빈값은 0`;

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
