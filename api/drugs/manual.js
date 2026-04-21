const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { product_code, product_name, company_name, gnl_nm_cd, mx_cprc } = req.body;
    if (!product_name || !company_name) {
      return res.status(400).json({ error: '제품명과 제약사명은 필수입니다' });
    }
    const { error } = await supabase
      .from('drug_master')
      .insert({
        product_code: product_code || null,
        product_name,
        company_name,
        gnl_nm_cd: gnl_nm_cd || null,
        mx_cprc: parseFloat(mx_cprc) || 0,
        pay_tp_nm: '비급여'
      });
    if (error) throw new Error(error.message);
    res.json({ success: true, message: '비급여 제품이 추가되었습니다.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
