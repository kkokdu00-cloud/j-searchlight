import { put } from '@vercel/blob';

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST — 업로드
  if (req.method === 'POST') {
    try {
      const { filename, contentType, dataBase64 } = req.body;
      if (!filename || !dataBase64) {
        return res.status(400).json({ error: 'filename, dataBase64 필요' });
      }

      const buffer = Buffer.from(dataBase64, 'base64');
      const blob = await put(`edi-attachments/${filename}`, buffer, {
        access: 'public',
        contentType: contentType || 'application/octet-stream',
        token: process.env.BLOB_READ_WRITE_TOKEN
      });

      return res.json({ url: blob.url });
    } catch (err) {
      console.error('Blob upload error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE — 삭제
  if (req.method === 'DELETE') {
    try {
      const { del } = await import('@vercel/blob');
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'url 필요' });

      await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
      return res.json({ success: true });
    } catch (err) {
      console.error('Blob delete error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
