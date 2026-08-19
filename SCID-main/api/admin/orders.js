// api/admin/orders.js
// Router เท่านั้น — business logic อยู่ที่ _lib/handlers/admin-orders.js
//
// GET  /api/admin/orders?status=&page=&search=        → list
// POST /api/admin/orders  body:{action:'approve', order_id}          → approve (auto-deliver)
// POST /api/admin/orders  body:{action:'reject', order_id, reason}   → reject

import { requireAdmin, errorResponse }        from '../_lib/auth.js';
import { listOrders, approveOrder, rejectOrder } from '../_lib/handlers/admin-orders.js';
import { parseRequestUrl }                       from '../_lib/request-url.js';

export const config = { runtime: "nodejs" };

export async function GET(req) {
  try {
    await requireAdmin(req);
    const result = await listOrders(parseRequestUrl(req));
    return Response.json({ success: true, ...result });
  } catch (err) {
    console.error('GET /api/admin/orders failed:', err);
    return errorResponse(err);
  }
}

export async function POST(req) {
  try {
    await requireAdmin(req);
    const { action, order_id, reason } = await req.json();

    if (action === 'approve') {
      const { httpStatus, body } = await approveOrder(order_id);
      return Response.json(body, { status: httpStatus });
    }

    if (action === 'reject') {
      const { httpStatus, body } = await rejectOrder(order_id, reason);
      return Response.json(body, { status: httpStatus });
    }

    return Response.json(
      { success: false, error: `ไม่รู้จัก action: ${action}` },
      { status: 400 }
    );
  } catch (err) {
    console.error('POST /api/admin/orders failed:', err);
    return errorResponse(err);
  }
}
