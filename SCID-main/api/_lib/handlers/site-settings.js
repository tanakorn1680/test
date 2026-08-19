// api/_lib/handlers/site-settings.js
// Business logic สำหรับ site_settings key-value — รวมจาก admin/settings.js + public settings.js เดิม

import { supabaseAdmin } from '../supabase.js';

/**
 * public — อ่าน setting ทั้งหมด ไม่ต้อง login
 * เดิมคือ GET /api/settings
 */
export async function publicGetSettings() {
  const { data, error } = await supabaseAdmin
    .from('site_settings')
    .select('key, value');

  if (error) throw error;

  const settings = {};
  for (const row of data) settings[row.key] = row.value;

  return { httpStatus: 200, body: { success: true, data: settings } };
}

export async function adminGetSettings() {
  const { data, error } = await supabaseAdmin
    .from('site_settings')
    .select('key, value, updated_at');

  if (error) throw error;

  const settings = {};
  for (const row of data) settings[row.key] = row.value;

  return { httpStatus: 200, body: { success: true, data: settings } };
}

export async function adminPutSettings({ updates }) {
  if (!updates || typeof updates !== 'object' || !Object.keys(updates).length) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่มีข้อมูลที่จะอัปเดต' } };
  }

  const rows = Object.entries(updates).map(([key, value]) => ({ key, value }));

  const { error } = await supabaseAdmin
    .from('site_settings')
    .upsert(rows, { onConflict: 'key' });

  if (error) throw error;

  return { httpStatus: 200, body: { success: true } };
}
