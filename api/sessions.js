const supabase = require('./_db');

// GET /api/sessions ???„ì²´ ëª©ë¡
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET ??ëª©ë¡ ì¡°íšŒ (user_id ?Œë¼ë¯¸í„° ?ˆìœ¼ë©??´ë‹¹ ? ì?ë§?
  if (req.method === 'GET') {
    const { user_id } = req.query;
    let query = supabase.from('edi_sessions').select('*').order('saved_at', { ascending: false });
    if (user_id) query = query.eq('user_id', user_id);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  }

  // POST ???€??
  if (req.method === 'POST') {
    const session = req.body;
    if (!session.hospital || !session.pharma) {
      return res.status(400).json({ error: 'ë³‘ì˜?ëª…ê³??œì•½?¬ëª…?€ ?„ìˆ˜?…ë‹ˆ??' });
    }

    const { data, error } = await supabase
      .from('edi_sessions')
      .upsert({
        id:           session.id,
        user_id:      session.user_id || null,
        user_name:    session.user_name || '',
        hospital:     session.hospital,
        pharma:       session.pharma,
        bizno:        session.bizno || '',
        presc:        session.presc || '',
        settle:       session.settle || '',
        note:         session.note || '',
        rows:         session.rows || [],
        attach_files: session.attachFiles || [],
        saved_at:     new Date().toISOString()
      }, { onConflict: 'id' });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // DELETE ???? œ
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id ?„ìš”' });

    const { error } = await supabase
      .from('edi_sessions')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
