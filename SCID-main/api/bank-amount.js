// api/bank-amount.js
// รับ notification จากแอป Bank Amount Reader
// → บันทึกลง bank_notifications
// → จับคู่กับ order ที่ unique_amount ตรงกัน
// → approve (deliver_order) อัตโนมัติ
//
// POST /api/bank-amount
// Authorization: Bearer {DEVICE_TOKEN}
// Body: { amount, currency, bank, timestamp, notification_id, is_test }

import { supabaseAdmin } from './_lib/supabase.js';
import { approveOrder }  from './_lib/handlers/admin-orders.js';

export const config = { runtime: 'nodejs' };

const DEVICE_TOKEN = process.env.DEVICE_TOKEN;

export async function POST(req) {
  // ตรวจ token
  const auth = req.headers.get('authorization') || '';
  if (!DEVICE_TOKEN || auth !== `Bearer ${DEVICE_TOKEN}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { amount, currency = 'THB', bank, timestamp, notification_id, is_test = false } = body;

  // ตรวจ field ครบ
  if (!amount || !bank || !timestamp || !notification_id) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // ========================================================
  // บันทึก notification (ป้องกัน duplicate ด้วย UNIQUE constraint)
  // ========================================================
  const { error: insertErr } = await supabaseAdmin
    .from('bank_notifications')
    .insert({ amount, currency, bank, timestamp, notification_id, is_test });

  if (insertErr) {
    // duplicate notification_id → ถือว่า OK แค่ ignore
    if (insertErr.code === '23505') {
      return Response.json({ status: 'duplicate, ignored' }, { status: 200 });
    }
    console.error('bank_notifications insert error:', insertErr);
    return Response.json({ error: insertErr.message }, { status: 500 });
  }

  // is_test → ไม่จับคู่ order จริง
  if (is_test) {
    return Response.json({ status: 'test_received' }, { status: 200 });
  }

  // ========================================================
  // จับคู่ order จาก unique_amount
  // ========================================================
  const { data: matchedOrderId, error: matchErr } = await supabaseAdmin
    .rpc('auto_match_payment', {
      p_amount:          amount,
      p_notification_id: notification_id,
      p_bank:            bank,
      p_timestamp:       timestamp,
    });

  if (matchErr) {
    console.error('auto_match_payment error:', matchErr);
    return Response.json({ status: 'saved, match_failed', error: matchErr.message }, { status: 200 });
  }

  if (!matchedOrderId) {
    // ไม่เจอ order ที่ตรงกัน — notification บันทึกไว้แล้ว แอดมินตรวจเองได้
    return Response.json({ status: 'saved, no_match' }, { status: 200 });
  }

  // อัปเดต bank_notifications ให้รู้ว่า match order ไหน
  await supabaseAdmin
    .from('bank_notifications')
    .update({ matched_order_id: matchedOrderId })
    .eq('notification_id', notification_id);

  // ========================================================
  // Approve order อัตโนมัติ (deliver_order RPC)
  // ========================================================
  const { httpStatus, body: approveBody } = await approveOrder(matchedOrderId);

  if (httpStatus === 200 && approveBody.success) {
    console.log(`Auto-approved order ${matchedOrderId} from notification ${notification_id}`);
    return Response.json({
      status:    'matched_and_approved',
      order_id:  matchedOrderId,
    }, { status: 200 });
  }

  // approve ไม่สำเร็จ (เช่น out of stock) — order อยู่ที่ awaiting_review
  // แอดมินจะเห็นและ approve เองได้
  console.warn(`Auto-approve failed for order ${matchedOrderId}:`, approveBody);
  return Response.json({
    status:   'matched_awaiting_review',
    order_id: matchedOrderId,
    reason:   approveBody.error,
  }, { status: 200 });
}
