// ============================================================
// api/_lib/products.js
// สินค้าอ่านจากตาราง products ใน DB (V3 — เดิมเป็น hardcoded object)
// แอดมินแก้ผ่านหน้า Products UI ได้เลย ไม่ต้องแก้ไฟล์นี้/deploy ใหม่
// ============================================================

import { supabaseAdmin } from './supabase.js';

/**
 * ดึงสินค้าจาก key (เฉพาะที่ is_active=true)
 * คืน null ถ้าไม่พบหรือปิดขายแล้ว
 * ใช้ตอนสร้าง order — ป้องกันการสั่งซื้อสินค้าที่แอดมินปิดขายไปแล้ว
 */
export async function getProduct(key) {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('key, label, category, price')
    .eq('key', key)
    .eq('is_active', true)
    .single();

  if (error || !data) return null;
  return data;
}
