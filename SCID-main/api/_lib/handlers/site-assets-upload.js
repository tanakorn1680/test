// api/_lib/handlers/site-assets-upload.js
// Business logic สำหรับอัปโหลดรูปเข้า bucket 'site-assets' — รวมจาก
// admin/upload-asset.js (logo/banner) + admin/upload-payment-qr.js (QR ช่องทางชำระเงิน)
// เหตุผลที่รวม: ทั้งคู่เขียนเข้า bucket เดียวกัน ใช้ validation เดียวกัน
// ต่างกันแค่ logo/banner ผูกกับ site_settings โดยอัตโนมัติ ส่วน QR แค่คืน URL เฉยๆ
// (เพราะ QR ผูกกับ payment_methods.details ซึ่งเป็นคนละตารางที่ handler นี้ไม่ควรไปยุ่ง)

import { supabaseAdmin } from '../supabase.js';
import { detectImageType } from '../file-validation.js';

const ALLOWED_ASSET_KEYS = ['logo_url', 'banner_url'];

/**
 * uploadSiteAsset — logo หรือ banner บันทึกลง site_settings อัตโนมัติหลังอัปโหลด
 * เดิมคือ POST /api/admin/upload-asset
 */
export async function uploadSiteAsset(form) {
  const assetKey = form.get('asset_key');
  const file     = form.get('file');

  if (!assetKey || !file) {
    return { httpStatus: 400, body: { success: false, error: 'ข้อมูลไม่ครบ' } };
  }

  if (!ALLOWED_ASSET_KEYS.includes(assetKey)) {
    return { httpStatus: 400, body: { success: false, error: 'ประเภทรูปภาพไม่ถูกต้อง' } };
  }

  if (file.size > 5 * 1024 * 1024) {
    return { httpStatus: 400, body: { success: false, error: 'ไฟล์ใหญ่เกิน 5MB' } };
  }

  const arrayBuffer = await file.arrayBuffer();
  const ext = detectImageType(arrayBuffer);
  if (!ext) {
    return { httpStatus: 400, body: { success: false, error: 'รองรับเฉพาะ JPG, PNG, WEBP เท่านั้น' } };
  }

  const storagePath = `${assetKey}-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('site-assets')
    .upload(storagePath, arrayBuffer, {
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      upsert: true,
    });

  if (uploadErr) throw uploadErr;

  const { data: publicUrlData } = supabaseAdmin.storage
    .from('site-assets')
    .getPublicUrl(storagePath);

  const publicUrl = publicUrlData.publicUrl;

  const { error: settingsErr } = await supabaseAdmin
    .from('site_settings')
    .upsert({ key: assetKey, value: publicUrl }, { onConflict: 'key' });

  if (settingsErr) throw settingsErr;

  return { httpStatus: 200, body: { success: true, data: { url: publicUrl } } };
}

/**
 * uploadPaymentQr — QR ช่องทางชำระเงิน แค่อัปโหลดคืน URL ไม่บันทึกที่ไหนอัตโนมัติ
 * เดิมคือ POST /api/admin/upload-payment-qr
 */
export async function uploadPaymentQr(form) {
  const file = form.get('file');

  if (!file) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่พบไฟล์' } };
  }

  if (file.size > 5 * 1024 * 1024) {
    return { httpStatus: 400, body: { success: false, error: 'ไฟล์ใหญ่เกิน 5MB' } };
  }

  const arrayBuffer = await file.arrayBuffer();
  const ext = detectImageType(arrayBuffer);
  if (!ext) {
    return { httpStatus: 400, body: { success: false, error: 'รองรับเฉพาะ JPG, PNG, WEBP เท่านั้น' } };
  }

  const storagePath = `payment-qr-${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('site-assets')
    .upload(storagePath, arrayBuffer, {
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    });

  if (uploadErr) throw uploadErr;

  const { data: publicUrlData } = supabaseAdmin.storage
    .from('site-assets')
    .getPublicUrl(storagePath);

  return { httpStatus: 200, body: { success: true, data: { url: publicUrlData.publicUrl } } };
}
