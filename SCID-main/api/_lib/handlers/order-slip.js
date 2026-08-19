// api/_lib/handlers/order-slip.js
// Business logic สำหรับสลิปการโอนเงิน — รวมจาก orders/upload-slip.js + admin/slip-url.js เดิม
// เหตุผลที่รวม: ทั้งคู่แตะ storage bucket 'slips' เดียวกัน
// (upload = ลูกค้าเขียนของตัวเอง, getSignedUrl = แอดมินอ่านเพื่อตรวจสอบ)
// สิทธิ์การเข้าถึงต่างกันสิ้นเชิง — ผู้เรียก (router) เป็นตัวตัดสินว่าจะเรียก
// requireAuth หรือ requireAdmin ก่อนเรียกฟังก์ชันในไฟล์นี้ ไม่ใช่ไฟล์นี้ตัดสินเอง

import { supabaseAdmin }   from '../supabase.js';
import { detectImageType } from '../file-validation.js';

/**
 * uploadSlip — ลูกค้าอัปโหลดสลิป เปลี่ยน order เป็น awaiting_review
 * เดิมคือ POST /api/orders/upload-slip — ต้อง requireAuth + ownership check
 */
export async function uploadSlip(profile, form) {
  const orderId = form.get('order_id');
  const file    = form.get('file');

  if (!orderId || !file) {
    return { httpStatus: 400, body: { success: false, error: 'ข้อมูลไม่ครบ' } };
  }

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .select('id, status, user_id, product_key')
    .eq('id', orderId)
    .single();

  if (orderErr || !order) {
    return { httpStatus: 404, body: { success: false, error: 'ไม่พบออเดอร์' } };
  }

  if (order.user_id !== profile.id) {
    return { httpStatus: 403, body: { success: false, error: 'ไม่มีสิทธิ์' } };
  }

  if (!['pending', 'awaiting_review'].includes(order.status)) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่สามารถอัปโหลดสลิปในสถานะนี้' } };
  }

  // เช็คสต็อกก่อนรับสลิป — กันลูกค้าจ่ายเงินไปเปล่าๆ ถ้าคลังหมดไปแล้วระหว่างรอ
  // (เช่น คนอื่นซื้อไอดีตัวสุดท้ายไปก่อนระหว่างที่ order นี้ยังค้าง pending อยู่)
  // ยังไม่ auto-cancel order ตรงนี้ เพราะแอดมินอาจเติมคลังใหม่ทีหลังได้ —
  // แค่บล็อกไม่ให้อัปโหลดสลิปตอนที่ยังไม่มีของจริง
  const { count: readyCount, error: stockErr } = await supabaseAdmin
    .from('inventory')
    .select('id', { count: 'exact', head: true })
    .eq('product_key', order.product_key)
    .eq('status', 'ready');

  if (stockErr) throw stockErr;

  if (!readyCount) {
    return {
      httpStatus: 409,
      body: { success: false, error: 'สินค้านี้หมดชั่วคราว กรุณาติดต่อแอดมินก่อนโอนเงิน' },
    };
  }

  if (file.size > 5 * 1024 * 1024) {
    return { httpStatus: 400, body: { success: false, error: 'ไฟล์ใหญ่เกิน 5MB' } };
  }

  const arrayBuffer = await file.arrayBuffer();
  const ext = detectImageType(arrayBuffer);
  if (!ext) {
    return { httpStatus: 400, body: { success: false, error: 'รองรับเฉพาะ JPG, PNG, WEBP เท่านั้น' } };
  }

  const storagePath = `${profile.id}/${orderId}.${ext}`;
  const { error: uploadErr } = await supabaseAdmin.storage
    .from('slips')
    .upload(storagePath, arrayBuffer, {
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      upsert: true,
    });

  if (uploadErr) throw uploadErr;

  const { error: updateErr } = await supabaseAdmin
    .from('orders')
    .update({ status: 'awaiting_review', slip_path: storagePath })
    .eq('id', orderId);

  if (updateErr) throw updateErr;

  return { httpStatus: 200, body: { success: true } };
}

/**
 * getSignedSlipUrl — แอดมินขอ signed URL เพื่อดูสลิป (อายุ 10 นาที)
 * เดิมคือ GET /api/admin/slip-url?order_id= — ต้อง requireAdmin
 */
export async function getSignedSlipUrl(orderId) {
  if (!orderId) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่ระบุ order_id' } };
  }

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .select('slip_path')
    .eq('id', orderId)
    .single();

  if (orderErr || !order?.slip_path) {
    return { httpStatus: 404, body: { success: false, error: 'ไม่พบสลิป' } };
  }

  const { data, error } = await supabaseAdmin.storage
    .from('slips')
    .createSignedUrl(order.slip_path, 60 * 10);

  if (error || !data?.signedUrl) throw error;

  return { httpStatus: 200, body: { success: true, url: data.signedUrl } };
}
