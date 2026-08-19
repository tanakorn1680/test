// /api/admin/inventory
// Admin only — จัดการคลังไอดี
//
// GET    ?product_key=xxx&status=ready   → list พร้อม filter
// GET    ?id=xxx                         → ดู credential (email+password+instruction) แบบ lazy-load
// POST   { product_key, gmail, password, instruction_title?, instruction_body? }
//                                        → เพิ่มทีละ 1 ไอดี พร้อม instruction ที่ลูกค้าจะเห็น
// DELETE { id }                          → ลบรายการที่ยัง status='ready' เท่านั้น
// DELETE { id, force: true }             → force delete ไอดีที่มี order ผูกอยู่ (สำหรับลบไอดีทดสอบ)

import { requireAdmin, errorResponse } from '../_lib/auth.js';
import { supabaseAdmin }               from '../_lib/supabase.js';
import { encrypt, decrypt }            from '../_lib/crypto.js';
import { parseRequestUrl }             from '../_lib/request-url.js';

export const config = { runtime: "nodejs" };

export async function GET(req) {
  try {
    await requireAdmin(req);
    const url = parseRequestUrl(req);
    if (url.searchParams.get('id')) {
      return await getCredential(url);
    }
    return await listInventory(url);
  } catch (err) {
    console.error('GET /api/admin/inventory failed:', err);
    return errorResponse(err);
  }
}

export async function POST(req) {
  try {
    await requireAdmin(req);
    return await singleAddInventory(req);
  } catch (err) {
    console.error('POST /api/admin/inventory failed:', err);
    return errorResponse(err);
  }
}

export async function PUT(req) {
  try {
    await requireAdmin(req);
    return await updateInventory(req);
  } catch (err) {
    console.error('PUT /api/admin/inventory failed:', err);
    return errorResponse(err);
  }
}

export async function DELETE(req) {
  try {
    await requireAdmin(req);
    return await deleteInventory(req);
  } catch (err) {
    console.error('DELETE /api/admin/inventory failed:', err);
    return errorResponse(err);
  }
}


async function listInventory(url) {
  const productKey = url.searchParams.get('product_key') || null;
  const status     = url.searchParams.get('status') || null;

  let query = supabaseAdmin
    .from('inventory')
    .select('id, product_key, gmail, status, order_id, sold_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (productKey) query = query.eq('product_key', productKey);
  if (status)     query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;

  // สรุปจำนวนคงเหลือต่อสินค้า (status='ready') — ใช้แสดงบนหน้า inventory
  // ใช้ RPC ที่ GROUP BY ใน SQL แทนดึงทุกแถวมานับใน JS (เร็วกว่ามากเมื่อคลังมีของเยอะ)
  const { data: readyCounts, error: countErr } = await supabaseAdmin
    .rpc('inventory_ready_counts');

  if (countErr) throw countErr;

  const summary = {};
  for (const row of readyCounts) {
    summary[row.product_key] = Number(row.ready_count);
  }

  return Response.json({ success: true, data, ready_summary: summary });
}

async function getCredential(url) {
  const id = url.searchParams.get('id');

  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select('id, gmail, password_enc, status, order_id, sold_at, instruction_title, instruction_body')
    .eq('id', id)
    .single();

  if (error || !data) {
    return Response.json(
      { success: false, error: 'ไม่พบรายการนี้' },
      { status: 404 }
    );
  }

  let password = null;
  try {
    password = decrypt(data.password_enc);
  } catch {
    return Response.json(
      { success: false, error: 'ถอดรหัสไม่สำเร็จ' },
      { status: 500 }
    );
  }

  return Response.json({
    success: true,
    data: {
      id:                  data.id,
      gmail:               data.gmail,
      password,
      status:              data.status,
      order_id:            data.order_id,
      sold_at:             data.sold_at,
      instruction_title:   data.instruction_title ?? null,
      instruction_body:    data.instruction_body  ?? null,
    },
  });
}

async function singleAddInventory(req) {
  const body = await req.json();
  const { product_key, gmail, password, instruction_title, instruction_body } = body;

  // --- validation ---
  if (!product_key || !gmail?.trim() || !password?.trim()) {
    return Response.json(
      { success: false, error: 'กรุณาระบุสินค้า, Gmail และรหัสผ่าน' },
      { status: 400 }
    );
  }

  // ตรวจว่า product_key มีจริง
  const { data: product, error: productErr } = await supabaseAdmin
    .from('products')
    .select('key')
    .eq('key', product_key)
    .single();

  if (productErr || !product) {
    return Response.json(
      { success: false, error: 'ไม่พบสินค้านี้' },
      { status: 400 }
    );
  }

  const row = {
    product_key,
    gmail:         gmail.trim(),
    password_enc:  encrypt(password.trim()),
    status:        'ready',
    instruction_title: instruction_title?.trim() || null,
    instruction_body:  instruction_body?.trim()  || null,
  };

  const { error: insertErr } = await supabaseAdmin
    .from('inventory')
    .insert([row]);

  if (insertErr) throw insertErr;

  return Response.json({ success: true, added: 1 });
}

async function updateInventory(req) {
  const body = await req.json();
  const { id, gmail, password, instruction_title, instruction_body } = body;

  if (!id) {
    return Response.json(
      { success: false, error: 'ไม่ระบุ id' },
      { status: 400 }
    );
  }

  // ตรวจสอบว่า record นี้ยังเป็น ready อยู่ (ไม่ให้แก้ไอดีที่ขายไปแล้ว)
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('inventory')
    .select('id, status')
    .eq('id', id)
    .single();

  if (fetchErr || !existing) {
    return Response.json(
      { success: false, error: 'ไม่พบรายการนี้' },
      { status: 404 }
    );
  }

  if (existing.status !== 'ready') {
    return Response.json(
      { success: false, error: 'ไม่สามารถแก้ไขไอดีที่ขายไปแล้วได้' },
      { status: 400 }
    );
  }

  // สร้าง patch object เฉพาะ field ที่ส่งมา (ไม่บังคับครบทุก field)
  const patch = {};

  if (gmail !== undefined) {
    if (!gmail?.trim()) {
      return Response.json(
        { success: false, error: 'Gmail ไม่ควรเป็นค่าว่าง' },
        { status: 400 }
      );
    }
    patch.gmail = gmail.trim();
  }

  if (password !== undefined) {
    if (!password?.trim()) {
      return Response.json(
        { success: false, error: 'รหัสผ่านไม่ควรเป็นค่าว่าง' },
        { status: 400 }
      );
    }
    patch.password_enc = encrypt(password.trim());
  }

  // instruction fields ยอมให้ส่ง null เพื่อลบออกได้
  if (instruction_title !== undefined) {
    patch.instruction_title = instruction_title?.trim() || null;
  }
  if (instruction_body !== undefined) {
    patch.instruction_body = instruction_body?.trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json(
      { success: false, error: 'ไม่มีข้อมูลที่ต้องการแก้ไข' },
      { status: 400 }
    );
  }

  const { error: updateErr } = await supabaseAdmin
    .from('inventory')
    .update(patch)
    .eq('id', id)
    .eq('status', 'ready'); // double-check status ตอน update ด้วย

  if (updateErr) throw updateErr;

  return Response.json({ success: true });
}

async function deleteInventory(req) {
  const body = await req.json();
  const { id, force } = body;

  if (!id) {
    return Response.json(
      { success: false, error: 'ไม่ระบุ id' },
      { status: 400 }
    );
  }

  if (force === true) {
    // Force delete — ใช้สำหรับลบไอดีทดสอบที่มี order ผูกอยู่
    // ไม่มีเงื่อนไข status หรือ order_id — ลบตรงๆ โดย admin ยืนยันแล้ว
    const { data, error } = await supabaseAdmin
      .from('inventory')
      .delete()
      .eq('id', id)
      .select('id')
      .single();

    if (error || !data) {
      return Response.json(
        { success: false, error: 'ไม่พบรายการ หรือลบไม่สำเร็จ' },
        { status: 400 }
      );
    }

    return Response.json({ success: true, forced: true });
  }

  // ปกติ — ลบได้เฉพาะ status='ready' และไม่มี order ผูก (กันลบไอดีที่ขายไปแล้วโดยไม่ตั้งใจ)
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .delete()
    .eq('id', id)
    .eq('status', 'ready')
    .is('order_id', null)
    .select('id')
    .single();

  if (error || !data) {
    return Response.json(
      { success: false, error: 'ไม่พบรายการ หรือรายการนี้ถูกขายไปแล้ว ไม่สามารถลบได้' },
      { status: 400 }
    );
  }

  return Response.json({ success: true });
}
