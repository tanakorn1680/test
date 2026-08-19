// GET /api/admin/customers
// Admin only — รายชื่อลูกค้า + ยอดสั่งซื้อสะสม (อ่านอย่างเดียว ไม่มีแก้ไข)

import { requireAdmin, errorResponse } from '../_lib/auth.js';
import { supabaseAdmin }               from '../_lib/supabase.js';

export const config = { runtime: "nodejs" };

export async function GET(req) {
  try {
    await requireAdmin(req);

    // ใช้ RPC ที่ join + aggregate ใน SQL แทนดึง orders ทุกแถวมา loop ใน JS
    // (เร็วกว่ามากเมื่อจำนวนออเดอร์ในระบบเยอะขึ้น)
    const { data, error } = await supabaseAdmin.rpc('customer_summary');
    if (error) throw error;

    // bigint จาก Postgres มาเป็น string ผ่าน driver — แปลงให้ชัดเจน
    const result = data.map(row => ({
      ...row,
      total_spent: Number(row.total_spent),
      order_count: Number(row.order_count),
    }));

    return Response.json({ success: true, data: result });

  } catch (err) {
    console.error('GET /api/admin/customers failed:', err);
    return errorResponse(err);
  }
}
