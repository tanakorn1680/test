// api/_lib/handlers/catalog-products.js
// Business logic สำหรับสินค้า — รวมจาก admin/products.js + public products.js เดิม
// เหตุผลที่รวม: ทั้งคู่แตะตาราง `products` เดียวกัน ต่างกันแค่ scope ของสิทธิ์
// (public เห็นเฉพาะ is_active=true, admin เห็น/แก้ได้ทุกอย่าง)
//
// สำคัญ: publicListProducts ไม่ต้อง auth เลย ต้องแยกจาก admin function ให้ชัด
// ที่ router — ห้ามเรียก requireAdmin ก่อนเข้าถึงฟังก์ชันนี้

import { supabaseAdmin } from '../supabase.js';
import { getImagesByKeys } from './catalog-product-images.js';

/**
 * public — สินค้าที่เปิดขายเท่านั้น ไม่ต้อง login
 * เดิมคือ GET /api/products
 * รวม stock_count (จำนวนไอดีพร้อมขายในคลัง) เพื่อให้หน้าร้านแสดง
 * "คงเหลือ X ชิ้น" และปิดปุ่มซื้อถ้าหมด — ใช้ RPC เดิมจาก Phase 5
 * (inventory_ready_counts) แทนการ query inventory ทีละสินค้า (N+1)
 *
 * v2: เพิ่ม images[] ต่อสินค้า — batch query 1 ครั้ง ไม่เป็น N+1
 */
export async function publicListProducts() {
  const [productsResult, countsResult] = await Promise.all([
    supabaseAdmin
      .from('products')
      .select('key, label, category, price, spec')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabaseAdmin.rpc('inventory_ready_counts'),
  ]);

  if (productsResult.error) throw productsResult.error;
  if (countsResult.error) throw countsResult.error;

  const productKeys = productsResult.data.map(p => p.key);

  const [stockByKey, imagesByKey] = await Promise.all([
    Promise.resolve(
      new Map(countsResult.data.map(row => [row.product_key, Number(row.ready_count)]))
    ),
    getImagesByKeys(productKeys),
  ]);

  const data = productsResult.data.map(p => ({
    ...p,
    stock_count: stockByKey.get(p.key) ?? 0,
    images:      imagesByKey.get(p.key) ?? [],
  }));

  return { httpStatus: 200, body: { success: true, data } };
}

/**
 * admin: list — ทุกสินค้ารวม is_active=false + images[]
 */
export async function adminListProducts() {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id, key, label, category, price, spec, is_active, sort_order, created_at')
    .order('sort_order', { ascending: true });

  if (error) throw error;

  const productKeys = data.map(p => p.key);
  const imagesByKey = await getImagesByKeys(productKeys);

  const enriched = data.map(p => ({
    ...p,
    images: imagesByKey.get(p.key) ?? [],
  }));

  return { httpStatus: 200, body: { success: true, data: enriched } };
}

/**
 * admin: create
 */
export async function adminCreateProduct({ key, label, category, price, spec, sort_order }) {
  if (!key || !label || !category || price == null) {
    return {
      httpStatus: 400,
      body: { success: false, error: 'กรุณากรอกข้อมูลให้ครบ (รหัสสินค้า, ชื่อ, ประเภท, ราคา)' },
    };
  }

  if (!/^[a-z0-9_]+$/.test(key)) {
    return {
      httpStatus: 400,
      body: { success: false, error: 'รหัสสินค้าต้องเป็นตัวอักษรภาษาอังกฤษพิมพ์เล็ก ตัวเลข และ _ เท่านั้น' },
    };
  }

  if (Number(price) < 0) {
    return { httpStatus: 400, body: { success: false, error: 'ราคาต้องไม่ติดลบ' } };
  }

  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      key, label, category,
      price: Number(price),
      spec: spec?.trim() || null,
      sort_order: sort_order ?? 0,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return { httpStatus: 400, body: { success: false, error: 'รหัสสินค้านี้มีอยู่แล้ว' } };
    }
    throw error;
  }

  return { httpStatus: 200, body: { success: true, data } };
}

/**
 * admin: update (single row)
 * รองรับ batch_sort: [{id, sort_order}] สำหรับ drag-and-drop reorder
 */
export async function adminUpdateProduct({ id, label, category, price, spec, is_active, sort_order, batch_sort }) {
  // ── batch sort_order update (drag reorder) ──
  if (Array.isArray(batch_sort) && batch_sort.length) {
    await Promise.all(
      batch_sort.map(({ id: pid, sort_order: so }) =>
        supabaseAdmin.from('products').update({ sort_order: so }).eq('id', pid)
      )
    );
    return { httpStatus: 200, body: { success: true } };
  }

  // ── single update ──
  if (!id) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่ระบุ id' } };
  }

  const updates = {};
  if (label      !== undefined) updates.label      = label;
  if (category   !== undefined) updates.category   = category;
  if (spec       !== undefined) updates.spec       = spec?.trim() || null;
  if (is_active  !== undefined) updates.is_active  = is_active;
  if (sort_order !== undefined) updates.sort_order = sort_order;
  if (price      !== undefined) {
    if (Number(price) < 0) {
      return { httpStatus: 400, body: { success: false, error: 'ราคาต้องไม่ติดลบ' } };
    }
    updates.price = Number(price);
  }

  const { data, error } = await supabaseAdmin
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  if (!data) {
    return { httpStatus: 404, body: { success: false, error: 'ไม่พบสินค้า' } };
  }

  return { httpStatus: 200, body: { success: true, data } };
}

/**
 * admin: delete — เฉพาะที่ไม่มี inventory ผูกอยู่
 * รูปภาพจะถูกลบ cascade ตาม ON DELETE CASCADE ที่ตั้งใน migration
 */
export async function adminDeleteProduct({ id }) {
  if (!id) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่ระบุ id' } };
  }

  const { data: product, error: productErr } = await supabaseAdmin
    .from('products')
    .select('key')
    .eq('id', id)
    .single();

  if (productErr || !product) {
    return { httpStatus: 404, body: { success: false, error: 'ไม่พบสินค้า' } };
  }

  const { count, error: invErr } = await supabaseAdmin
    .from('inventory')
    .select('id', { count: 'exact', head: true })
    .eq('product_key', product.key);

  if (invErr) throw invErr;

  if (count > 0) {
    return {
      httpStatus: 400,
      body: { success: false, error: `สินค้านี้มีไอดีในคลัง ${count} รายการ ไม่สามารถลบได้ กรุณาปิดขายแทน` },
    };
  }

  const { error: deleteErr } = await supabaseAdmin.from('products').delete().eq('id', id);
  if (deleteErr) throw deleteErr;

  return { httpStatus: 200, body: { success: true } };
}
