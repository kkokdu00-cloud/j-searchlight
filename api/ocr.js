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

  const prompt = `이 파일은 병원 EDI 처방 통계 화면입니다. 모니터를 직접 촬영한 사진일 수 있어 화질이 좋지 않을 수 있습니다.
화면에서 의약품 급여내역 테이블을 찾아 각 행을 추출하세요.

추출 규칙:
1. 보험코드(청구코드)는 보통 9자리 숫자입니다. 흐릿하면 비슷한 숫자로 최대한 추론하세요.
2. 제품명이 잘린 경우 읽을 수 있는 부분까지만 추출하세요.
3. 수량/단가에서 쉼표와 단위(정, 캡슐, mg 등)는 제거하고 숫자만 추출하세요.
4. 원내/원외 구분이 없으면 총사용량을 qin에 입력하세요.
5. 여러 제약사가 혼재된 경우 모든 행을 다 추출하고 note 필드에 제약사명을 기입하세요.
6. 헤더행(No, 제약회사, 등록코드 등)은 제외하고 데이터 행만 추출하세요.

응답 형식: 순수 JSON 배열만 응답 (마크다운 없이)
[{"code":"보험코드","name":"제품명","price":"단가","qin":"원내수량","qout":"원외수량","note":"제약사명"}]
항목이 없으면 [] 응답`;

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
