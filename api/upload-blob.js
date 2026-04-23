import { put } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { filename, contentType, base64 } = req.body;
  if (!filename || !base64) return res.status(400).json({ error: 'filename, base64 필수' });

  try {
    const buffer = Buffer.from(base64, 'base64');
    const blob = await put(`attachments/${Date.now()}_${filename}`, buffer, {
      access: 'public',
      contentType: contentType || 'application/octet-stream',
    });
    return res.json({ url: blob.url });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
