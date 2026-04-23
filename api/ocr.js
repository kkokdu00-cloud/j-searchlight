export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType } = req.body;
  if (!imageBase64 || !mediaType) {
    return res.status(400).json({ error: 'imageBase64, mediaType 필요' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  // BUG-2: PDF 감지 후 document 타입으로 전송
  const isPdf = mediaType === 'application/pdf';

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };
  if (isPdf) {
    headers['anthropic-beta'] = 'pdfs-2024-09-25';
  }

  const contentBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
    : { type: 'image',    source: { type: 'base64', media_type: mediaType,          data: imageBase64 } };

  const prompt = `이 이미지는 병의원 EDI 급여청구 내역서입니다.
아래 규칙에 따라 데이터를 추출해줘.

[최우선 규칙]
- 보험코드(숫자 9-13자리)를 정확히 읽는 것이 가장 중요해
- 보험코드가 불확실하면 빈칸으로 두고, 제품명은 이미지 텍스트 그대로 옮겨
- 텍스트 기반 추론 금지 — 반드시 이미지에 보이는 숫자/문자만 입력

[추출 필드]
- code: 보험코드 (숫자만, 하이픈 제거)
- name: 제품명 (이미지에 보이는 그대로)
- price: 단가 (숫자만)
- qin: 원내수량 (숫자만)
- qout: 원외수량 (숫자만)
- type: "처방" 또는 "조제"
- note: 제약사명이 보이면 입력, 없으면 빈칸

[출력 형식]
JSON 배열만 출력. 설명 없이.
예시: [{"code":"6431031230","name":"아스피린정","price":"100","qin":"10","qout":"0","type":"처방","note":""}]`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            { type: 'text', text: prompt }
          ]
        }]
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
