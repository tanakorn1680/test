// GET /api/admin/stats
// Admin only — ตัวเลข dashboard (เฉพาะที่ requirement ระบุ ไม่ใส่กราฟ/widget เกินจำเป็น)
//
// ยอดขายวันนี้ / ยอดขายเดือนนี้ / สมาชิกทั้งหมด /
// จำนวนสินค้า / จำนวนไอดีพร้อมขาย / ออเดอร์รออนุมัติ

import { requireAdmin, errorResponse } from '../_lib/auth.js';
import { supabaseAdmin }               from '../_lib/supabase.js';

export const config = { runtime: "nodejs" };

export async function GET(req) {
  try {
    await requireAdmin(req);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const startOfMonth  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [
      todayOrders,
      monthOrders,
      customerCount,
      productCount,
      readyInventoryCount,
      pendingReviewCount,
    ] = await Promise.all([

      // ยอดขายวันนี้ — รวม amount ของ order ที่ delivered ตั้งแต่ต้นวัน
      supabaseAdmin
        .from('orders')
        .select('amount')
        .eq('status', 'delivered')
        .gte('updated_at', startOfToday),

      // ยอดขายเดือนนี้
      supabaseAdmin
        .from('orders')
        .select('amount')
        .eq('status', 'delivered')
        .gte('updated_at', startOfMonth),

      // สมาชิกทั้งหมด (นับเฉพาะ role customer ไม่นับแอดมิน)
      supabaseAdmin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'customer'),

      // จำนวนสินค้า (ที่เปิดขายอยู่)
      supabaseAdmin
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true),

      // จำนวนไอดีพร้อมขาย
      supabaseAdmin
        .from('inventory')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'ready'),

      // ออเดอร์รออนุมัติ (อัปโหลดสลิปแล้ว รอแอดมินตรวจ)
      supabaseAdmin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'awaiting_review'),

    ]);

    if (todayOrders.error)   throw todayOrders.error;
    if (monthOrders.error)   throw monthOrders.error;

    const sumAmount = (rows) => rows.reduce((sum, r) => sum + Number(r.amount), 0);

    return Response.json({
      success: true,
      data: {
        revenue_today:      sumAmount(todayOrders.data ?? []),
        revenue_month:      sumAmount(monthOrders.data ?? []),
        total_customers:    customerCount.count       ?? 0,
        product_count:      productCount.count        ?? 0,
        inventory_ready:    readyInventoryCount.count ?? 0,
        pending_review:     pendingReviewCount.count  ?? 0,
      },
    });

  } catch (err) {
    console.error('GET /api/admin/stats failed:', err);
    return errorResponse(err);
  }
}
