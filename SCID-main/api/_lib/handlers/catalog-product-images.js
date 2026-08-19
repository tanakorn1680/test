// api/_lib/handlers/catalog-product-images.js
// Business logic สำหรับจัดการรูปภาพสินค้า (product_images)
//
// Design decisions:
// - ใช้ bucket 'site-assets' ที่มีอยู่แล้ว ไม่สร้าง bucket ใหม่ (Supabase Free = 1 bucket public)
// - path: product-img/{product_key}/{uuid}.{ext}  → จัดกลุ่มตามสินค้า ลบเป็น folder ได้ง่าย
// - is_cover มี partial unique index ใน DB → set cover ทำ 2 step: unset เดิม, set ใหม่
// - ขนาดไฟล์สูงสุด 5MB ตาม policy ของ site-assets เดิม
// - จำนวนรูปสูงสุด 10 รูป/สินค้า (ป้องกัน abuse)

import { supabaseAdmin } from '../supabase.js';
import { detectImageType } from '../file-validation.js';

const MAX_IMAGES_PER_PRODUCT = 10;

// ─────────────────────────────────────────────────────────────
// Public: ดึงรูปภาพทุกรูปของสินค้าหลาย key พร้อมกัน (batch)
// ใช้ใน publicListProducts เพื่อ join images เข้าข้อมูลสินค้า
// ─────────────────────────────────────────────────────────────
export async function getImagesByKeys(productKeys) {
  if (!productKeys.length) return new Map();

  const { data, error } = await supabaseAdmin
    .from('product_images')
    .select('product_key, url, is_cover, sort_order')
    .in('product_key', productKeys)
    .order('sort_order', { ascending: true });

  if (error) throw error;

  // group by product_key → Map<key, images[]>
  const map = new Map();
  for (const row of data) {
    if (!map.has(row.product_key)) map.set(row.product_key, []);
    map.get(row.product_key).push({
      url:      row.url,
      is_cover: row.is_cover,
    });
  }
  return map;
}

// ─────────────────────────────────────────────────────────────
// Admin: list รูปของสินค้าตัวเดียว (พร้อม id สำหรับลบ/แก้ไข)
// ─────────────────────────────────────────────────────────────
export async function adminListImages({ product_key }) {
  if (!product_key) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่ระบุ product_key' } };
  }

  const { data, error } = await supabaseAdmin
    .from('product_images')
    .select('id, url, is_cover, sort_order, created_at')
    .eq('product_key', product_key)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return { httpStatus: 200, body: { success: true, data } };
}

// ─────────────────────────────────────────────────────────────
// Admin: upload รูปใหม่ให้สินค้า
// รับ FormData: product_key (text) + file (binary)
// ─────────────────────────────────────────────────────────────
export async function adminUploadImage(form) {
  const product_key = form.get('product_key')?.trim();
  const file        = form.get('file');

  if (!product_key || !file) {
    return { httpStatus: 400, body: { success: false, error: 'ข้อมูลไม่ครบ (product_key + file)' } };
  }

  // ตรวจสินค้ามีอยู่จริง
  const { data: product, error: productErr } = await supabaseAdmin
    .from('products')
    .select('key')
    .eq('key', product_key)
    .single();

  if (productErr || !product) {
    return { httpStatus: 404, body: { success: false, error: 'ไม่พบสินค้า' } };
  }

  // ตรวจจำนวนรูปที่มีอยู่แล้ว
  const { count, error: countErr } = await supabaseAdmin
    .from('product_images')
    .select('id', { count: 'exact', head: true })
    .eq('product_key', product_key);

  if (countErr) throw countErr;

  if (count >= MAX_IMAGES_PER_PRODUCT) {
    return {
      httpStatus: 400,
      body: { success: false, error: `เพิ่มได้สูงสุด ${MAX_IMAGES_PER_PRODUCT} รูปต่อสินค้า` },
    };
  }

  // ตรวจขนาดและประเภทไฟล์จาก magic bytes (ป้องกัน spoofing)
  if (file.size > 5 * 1024 * 1024) {
    return { httpStatus: 400, body: { success: false, error: 'ไฟล์ใหญ่เกิน 5MB' } };
  }

  const arrayBuffer = await file.arrayBuffer();
  const ext = detectImageType(arrayBuffer);
  if (!ext) {
    return { httpStatus: 400, body: { success: false, error: 'รองรับเฉพาะ JPG, PNG, WEBP เท่านั้น' } };
  }

  // Upload ไปยัง Storage
  const storagePath = `product-img/${product_key}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('site-assets')
    .upload(storagePath, arrayBuffer, {
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    });

  if (uploadErr) throw uploadErr;

  const { data: publicUrlData } = supabaseAdmin.storage
    .from('site-assets')
    .getPublicUrl(storagePath);

  const url = publicUrlData.publicUrl;

  // รูปแรกของสินค้าเป็น cover อัตโนมัติ
  const isCover = count === 0;

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('product_images')
    .insert({
      product_key,
      url,
      is_cover:   isCover,
      sort_order: count, // ใส่ท้ายสุด
    })
    .select()
    .single();

  if (insertErr) {
    // ถ้า insert ล้มเหลว ลบไฟล์ที่ upload ไปแล้วออกด้วย (cleanup)
    await supabaseAdmin.storage.from('site-assets').remove([storagePath]);
    throw insertErr;
  }

  return { httpStatus: 200, body: { success: true, data: inserted } };
}

// ─────────────────────────────────────────────────────────────
// Admin: ลบรูปภาพ (ลบทั้ง Storage + DB row)
// ถ้ารูปที่ลบเป็น cover → promote รูปถัดไปเป็น cover อัตโนมัติ
// ─────────────────────────────────────────────────────────────
export async function adminDeleteImage({ id }) {
  if (!id) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่ระบุ id' } };
  }

  // ดึงข้อมูลรูปก่อนลบ (ต้องการ url สำหรับ cleanup Storage + is_cover)
  const { data: img, error: fetchErr } = await supabaseAdmin
    .from('product_images')
    .select('id, url, is_cover, product_key')
    .eq('id', id)
    .single();

  if (fetchErr || !img) {
    return { httpStatus: 404, body: { success: false, error: 'ไม่พบรูปภาพ' } };
  }

  // ลบ DB row ก่อน (ถ้า DB ล้มเหลวไม่ต้องแตะ Storage)
  const { error: deleteErr } = await supabaseAdmin
    .from('product_images')
    .delete()
    .eq('id', id);

  if (deleteErr) throw deleteErr;

  // ลบออกจาก Storage (แยก path จาก public URL)
  const storagePrefix = '/object/public/site-assets/';
  const urlObj = new URL(img.url);
  const storagePath = urlObj.pathname.includes(storagePrefix)
    ? decodeURIComponent(urlObj.pathname.split(storagePrefix)[1])
    : null;

  if (storagePath) {
    // ลบ async ไม่ block — ถ้าพลาดแค่ orphan file ไม่กระทบ logic
    supabaseAdmin.storage.from('site-assets').remove([storagePath]).catch(console.error);
  }

  // ถ้าลบรูปที่เป็น cover → ตั้ง cover ให้รูปที่เหลือ (sort_order ต่ำสุด)
  if (img.is_cover) {
    const { data: remaining } = await supabaseAdmin
      .from('product_images')
      .select('id')
      .eq('product_key', img.product_key)
      .order('sort_order', { ascending: true })
      .limit(1);

    if (remaining?.length) {
      await supabaseAdmin
        .from('product_images')
        .update({ is_cover: true })
        .eq('id', remaining[0].id);
    }
  }

  return { httpStatus: 200, body: { success: true } };
}

// ─────────────────────────────────────────────────────────────
// Admin: เรียงลำดับรูปภาพใหม่
// รับ { product_key, order: [{id, sort_order}] }
// ลำดับ sort_order=0 จะถูก set เป็น cover อัตโนมัติ
// ─────────────────────────────────────────────────────────────
export async function adminReorderImages({ product_key, order }) {
  if (!product_key || !Array.isArray(order) || !order.length) {
    return { httpStatus: 400, body: { success: false, error: 'ข้อมูลไม่ครบ' } };
  }

  // อัป sort_order และ is_cover ทีละ row ใน parallel
  // is_cover = true เฉพาะ sort_order === 0 (ลำดับแรก = ปก)
  await Promise.all(
    order.map(({ id, sort_order }) =>
      supabaseAdmin
        .from('product_images')
        .update({
          sort_order,
          is_cover: sort_order === 0,
        })
        .eq('id', id)
        .eq('product_key', product_key) // double-check ownership
    )
  );

  return { httpStatus: 200, body: { success: true } };
}

// ─────────────────────────────────────────────────────────────
// Admin: เปลี่ยน cover (unset เดิม → set ใหม่)
// ─────────────────────────────────────────────────────────────
export async function adminSetCover({ id, product_key }) {
  if (!id || !product_key) {
    return { httpStatus: 400, body: { success: false, error: 'ไม่ระบุ id หรือ product_key' } };
  }

  // ตรวจ image เป็นของสินค้านี้จริง
  const { data: img, error: fetchErr } = await supabaseAdmin
    .from('product_images')
    .select('id')
    .eq('id', id)
    .eq('product_key', product_key)
    .single();

  if (fetchErr || !img) {
    return { httpStatus: 404, body: { success: false, error: 'ไม่พบรูปภาพ' } };
  }

  // Unset cover เดิมทั้งหมดของสินค้านี้ก่อน
  await supabaseAdmin
    .from('product_images')
    .update({ is_cover: false })
    .eq('product_key', product_key);

  // Set cover ใหม่
  const { data, error } = await supabaseAdmin
    .from('product_images')
    .update({ is_cover: true })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return { httpStatus: 200, body: { success: true, data } };
}
