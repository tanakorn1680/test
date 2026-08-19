// api/_lib/handlers/catalog-payment.js
// Business logic สำหรับช่องทางชำระเงิน — รวมจาก admin/payment-methods.js + public payment-methods.js เดิม
// เหตุผลที่รวม: ทั้งคู่แตะตาราง `payment_methods` เดียวกัน ต่างกันแค่ scope สิทธิ์

import { supabaseAdmin } from '../supabase.js';

const VALID_TYPES = ['promptpay', 'bank', 'truemoney', 'qr_code'];

/**
 * public — ช่องทางที่เปิดใช้งานเท่านั้น ไม่ต้อง login
 * เดิมคือ GET /api/payment-methods
 */
export async function publicListMethods() {
  const { data, error } = await supabaseAdmin
    .from('payment_methods')
    .select('id, type, label, details')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return { httpStatus: 200, body: { success: true, data } };
}

export async function adminListMethods() {
  const { data, error } = await supabaseAdmin
    .from('payment_methods')
    .select('id, type, label, details, is_active, sort_order, created_at')
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return { httpStatus: 200, body: { success: true, data } };
}

export async function adminCreateMethod({ type, label, details, sort_order }) {
  if (!type || !label) {
    return { httpStatus: 400, body: { success: false, error: 'กรุณากรอกประเภทและชื่อช่องทาง' } };
  }

  if (!VALID_TYPES.includes(type)) {
    return {
      httpStatus: 400,
      body: { success: false, error: `ประเภทต้องเป็นหนึ่งใน: ${VALID_TYPES.join(', ')}` },
    };
  }

  const { data, error } = await supabaseAdmin
    .from('payment_methods')
    .insert({ type, label, details: details ?? {}, sort_order: sort_order ?? 0 })
    .select()
    .single();

  if (error) throw error;
  return { httpStatus: 200, body: { success: true, data } };
}

export async function adminUpdateMethod({ id, label, details, is_active, sort_order }) {
  if (!id) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่ระบุ id' } };
  }

  const updates = {};
  if (label      !== undefined) updates.label      = label;
  if (details    !== undefined) updates.details    = details;
  if (is_active  !== undefined) updates.is_active  = is_active;
  if (sort_order !== undefined) updates.sort_order = sort_order;

  const { data, error } = await supabaseAdmin
    .from('payment_methods')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  if (!data) {
    return { httpStatus: 404, body: { success: false, error: 'ไม่พบช่องทางชำระเงิน' } };
  }

  return { httpStatus: 200, body: { success: true, data } };
}

export async function adminDeleteMethod({ id }) {
  if (!id) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่ระบุ id' } };
  }

  // order ที่เคยใช้ช่องทางนี้จะยัง reference id เดิมอยู่ (orders.payment_method_id ไม่ cascade)
  const { error } = await supabaseAdmin.from('payment_methods').delete().eq('id', id);
  if (error) throw error;

  return { httpStatus: 200, body: { success: true } };
}
