// api/_lib/handlers/customer-orders.js
// Business logic สำหรับ order lifecycle ฝั่งลูกค้า — รวมจาก
// orders/create.js + orders/detail.js + orders/my.js + orders/set-payment-method.js เดิม
// เหตุผลที่รวม: ทั้ง 4 endpoint แตะตาราง `orders` เป็นหลักตัวเดียว
// (create=insert, detail=select เดี่ยว, my=select list, set-payment-method=update field เดียว)
// ไม่มีตารางอื่นที่ endpoint ไหนต้อง lock ร่วมด้วยเหมือนกรณี fulfillment (inventory)
//
// ทุกฟังก์ชันรับ `profile` เป็นพารามิเตอร์ (ผ่าน requireAuth มาแล้วจาก router)
// แทนที่จะเรียก requireAuth เอง — ทำให้ handler เป็น pure function ทดสอบง่าย

import { supabaseAdmin } from '../supabase.js';
import { decrypt }       from '../crypto.js';
import { getProduct }    from '../products.js';

const PENDING_EXPIRY_MINUTES = 10;

/**
 * expirePendingOrders — sync order ที่ pending เกิน 10 นาทีให้เป็น cancelled จริงใน DB
 * (soft — ไม่ลบข้อมูล เก็บไว้เป็นประวัติ) เรียกจากทุก handler ที่อ่านข้อมูล order
 * ก่อนส่งกลับ เพื่อให้ลูกค้าและแอดมินเห็นสถานะตรงกันเสมอ ไม่ต้องพึ่ง cron job แยก
 * (ระบบยังไม่มี background job ใดๆ — เช็คตอนมีคนเปิดหน้าจึงเป็นทางที่ตรงไปตรงมาที่สุด)
 *
 * ไม่ throw ถ้า UPDATE ไม่มีอะไรให้ทำ (ไม่มี order ไหนหมดเวลาพอดี) — เงียบและไปต่อ
 */
async function expirePendingOrders(userId) {
  const cutoff = new Date(Date.now() - PENDING_EXPIRY_MINUTES * 60 * 1000).toISOString();

  const { error } = await supabaseAdmin
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('user_id', userId)
    .eq('status', 'pending')
    .lt('created_at', cutoff);

  if (error) console.error('expirePendingOrders failed:', error);
}

/**
 * generateUniqueAmount — สร้างยอดเงินเฉพาะสำหรับ order นี้
 *
 * ตัวอย่าง: ราคาสินค้า 150 บาท → ยอดโอน 150.24 บาท
 * เลข .XX คือเลขสุ่ม 01-98 เพื่อให้จับคู่กับ notification ธนาคารได้
 *
 * ตรวจ collision: ถ้า unique_amount นี้มี order pending อยู่แล้ว → สุ่มใหม่
 * (ป้องกันกรณีลูกค้า 2 คนสั่งพร้อมกันได้ยอดซ้ำกัน)
 */
async function generateUniqueAmount(basePrice) {
  const MAX_TRIES = 10;

  for (let i = 0; i < MAX_TRIES; i++) {
    const cents = Math.floor(Math.random() * 98) + 1; // 01-98
    const uniqueAmount = parseFloat(`${basePrice}.${String(cents).padStart(2, '0')}`);

    // ตรวจว่ายอดนี้ไม่มีใช้อยู่แล้วใน order pending (ภายใน 30 นาที)
    const { count } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('unique_amount', uniqueAmount)
      .eq('status', 'pending')
      .gt('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString());

    if ((count ?? 0) === 0) return uniqueAmount;
  }

  // fallback: ถ้าสุ่มชนทุกครั้ง (ไม่น่าเกิด) ใช้ timestamp แทน
  const fallbackCents = Date.now() % 98 + 1;
  return parseFloat(`${basePrice}.${String(fallbackCents).padStart(2, '0')}`);
}

/**
 * create — สร้าง order ใหม่ ราคาคำนวณ server-side เสมอ
 * เดิมคือ POST /api/orders/create
 *
 * v2: เพิ่ม unique_amount เพื่อให้แอป Bank Amount Reader จับคู่ได้อัตโนมัติ
 */
export async function createOrder(profile, { product_key }) {
  const product = await getProduct(product_key);
  if (!product) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่พบสินค้า' } };
  }

  // สร้างยอดเฉพาะ เช่น ราคา 150 → unique_amount = 150.24
  const uniqueAmount = await generateUniqueAmount(product.price);

  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .insert({
      user_id:       profile.id,
      user_email:    profile.email,
      product_key:   product.key,
      product_label: product.label,
      amount:        product.price,
      unique_amount: uniqueAmount,
      status:        'pending',
    })
    .select('id, product_label, amount, unique_amount, status, created_at')
    .single();

  if (error) throw error;

  return { httpStatus: 200, body: { success: true, data: order } };
}

/**
 * detail — รายละเอียด order รวม credential (ถ้า delivered แล้ว)
 * เดิมคือ GET /api/orders/detail?id=
 */
export async function getOrderDetail(profile, orderId) {
  if (!orderId) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่ระบุ order id' } };
  }

  await expirePendingOrders(profile.id);

  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .select('id, product_key, product_label, amount, unique_amount, status, reject_reason, created_at, updated_at, user_id')
    .eq('id', orderId)
    .single();

  if (error || !order) {
    return { httpStatus: 404, body: { success: false, error: 'ไม่พบออเดอร์' } };
  }

  if (order.user_id !== profile.id) {
    return { httpStatus: 403, body: { success: false, error: 'ไม่มีสิทธิ์' } };
  }

  let credential = null;

  // V3 เขียนลง inventory (ผ่าน deliver_order RPC) — เช็คก่อน
  // ถ้าไม่เจอ (order เก่าก่อน migration) fallback ไปอ่าน credentials เดิม (historical read-only)
  if (order.status === 'delivered') {
    const { data: inv, error: invErr } = await supabaseAdmin
      .from('inventory')
      .select('gmail, password_enc, sold_at, instruction_title, instruction_body')
      .eq('order_id', orderId)
      .single();

    if (!invErr && inv) {
      let password = null, decryptFailed = false;
      try {
        password = decrypt(inv.password_enc);
      } catch (decryptErr) {
        console.error(`decrypt failed for order ${orderId} (inventory):`, decryptErr);
        decryptFailed = true;
      }
      credential = { gmail: inv.gmail, password, delivered_at: inv.sold_at, decrypt_failed: decryptFailed, instruction_title: inv.instruction_title ?? null, instruction_body: inv.instruction_body ?? null };
    } else {
      const { data: cred, error: credErr } = await supabaseAdmin
        .from('credentials')
        .select('gmail, password_enc, delivered_at')
        .eq('order_id', orderId)
        .single();

      if (!credErr && cred) {
        let password = null, decryptFailed = false;
        try {
          password = decrypt(cred.password_enc);
        } catch (decryptErr) {
          console.error(`decrypt failed for order ${orderId} (credentials):`, decryptErr);
          decryptFailed = true;
        }
        credential = { gmail: cred.gmail, password, delivered_at: cred.delivered_at, decrypt_failed: decryptFailed };
      }
    }
  }

  // เช็คสต็อกเฉพาะตอน pending — จุดเดียวที่ checkout.html ต้องรู้ว่าจะโชว์
  // ฟอร์มอัปโหลดสลิปได้ไหม (สถานะอื่นไม่เกี่ยวกับสต็อกแล้ว)
  let inStock = null;
  if (order.status === 'pending') {
    const { count, error: stockErr } = await supabaseAdmin
      .from('inventory')
      .select('id', { count: 'exact', head: true })
      .eq('product_key', order.product_key)
      .eq('status', 'ready');

    if (stockErr) throw stockErr;
    inStock = (count ?? 0) > 0;
  }

  return {
    httpStatus: 200,
    body: {
      success: true,
      data: {
        id:            order.id,
        product_label: order.product_label,
        amount:        order.amount,
        unique_amount: order.unique_amount,
        status:        order.status,
        reject_reason: order.reject_reason,
        created_at:    order.created_at,
        updated_at:    order.updated_at,
        in_stock:      inStock,
        credential,
      },
    },
  };
}

/**
 * my — รายการ order ของ user ที่ login อยู่
 * เดิมคือ GET /api/orders/my
 */
export async function listMyOrders(profile) {
  await expirePendingOrders(profile.id);

  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('id, product_key, product_label, amount, status, created_at, updated_at')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false });

  if (error) throw error;

  // เช็คสต็อกเฉพาะ order ที่ pending (จุดเดียวที่ต้องโชว์/ซ่อนปุ่มชำระเงิน)
  // กันปุ่ม "ชำระเงิน" ค้างอยู่ทั้งที่คลังหมดไปแล้ว (ลูกค้าจ่ายไปก็ไม่มีของส่ง)
  const pendingProductKeys = [...new Set(
    data.filter(o => o.status === 'pending').map(o => o.product_key)
  )];

  let stockByKey = new Map();
  if (pendingProductKeys.length) {
    const { data: counts, error: countErr } = await supabaseAdmin.rpc('inventory_ready_counts');
    if (countErr) throw countErr;
    stockByKey = new Map(counts.map(row => [row.product_key, Number(row.ready_count)]));
  }

  const result = data.map(o => ({
    ...o,
    in_stock: o.status !== 'pending' ? null : (stockByKey.get(o.product_key) ?? 0) > 0,
  }));

  return { httpStatus: 200, body: { success: true, data: result } };
}

/**
 * setPaymentMethod — ผูกช่องทางชำระเงินที่ลูกค้าเลือกเข้ากับ order
 * เดิมคือ POST /api/orders/set-payment-method
 */
export async function setOrderPaymentMethod(profile, { order_id, payment_method_id }) {
  if (!order_id || !payment_method_id) {
    return { httpStatus: 400, body: { success: false, error: 'ข้อมูลไม่ครบ' } };
  }

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .select('id, status, user_id')
    .eq('id', order_id)
    .single();

  if (orderErr || !order) {
    return { httpStatus: 404, body: { success: false, error: 'ไม่พบออเดอร์' } };
  }

  if (order.user_id !== profile.id) {
    return { httpStatus: 403, body: { success: false, error: 'ไม่มีสิทธิ์' } };
  }

  if (order.status !== 'pending') {
    return {
      httpStatus: 400,
      body: { success: false, error: 'ไม่สามารถเปลี่ยนช่องทางชำระเงินในสถานะนี้' },
    };
  }

  const { data: method, error: methodErr } = await supabaseAdmin
    .from('payment_methods')
    .select('id, type, label, details')
    .eq('id', payment_method_id)
    .eq('is_active', true)
    .single();

  if (methodErr || !method) {
    return { httpStatus: 400, body: { success: false, error: 'ช่องทางชำระเงินนี้ไม่พร้อมใช้งาน' } };
  }

  const { error: updateErr } = await supabaseAdmin
    .from('orders')
    .update({ payment_method_id })
    .eq('id', order_id);

  if (updateErr) throw updateErr;

  return { httpStatus: 200, body: { success: true, data: method } };
}
