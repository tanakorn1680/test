// api/orders/index.js
// Router เท่านั้น — business logic อยู่ที่ _lib/handlers/customer-orders.js
//
// POST /api/orders?action=create              body:{product_key}
// GET  /api/orders?action=detail&id=          
// GET  /api/orders?action=my
// POST /api/orders?action=set-payment-method  body:{order_id, payment_method_id}
//
// ทุก action ต้อง login เหมือนกันหมด (requireAuth ครั้งเดียวพอ ต่างจาก
// catalog-products/catalog-payment ที่มี public branch แยกก่อน auth)

import { requireAuth, errorResponse } from '../_lib/auth.js';
import {
  createOrder,
  getOrderDetail,
  listMyOrders,
  setOrderPaymentMethod,
} from '../_lib/handlers/customer-orders.js';
import { parseRequestUrl } from '../_lib/request-url.js';

export const config = { runtime: "nodejs" };

export async function GET(req) {
  try {
    const { profile } = await requireAuth(req);
    const url    = parseRequestUrl(req);
    const action = url.searchParams.get('action');

    if (action === 'detail') {
      const orderId = url.searchParams.get('id');
      const { httpStatus, body } = await getOrderDetail(profile, orderId);
      return Response.json(body, { status: httpStatus });
    }

    if (action === 'my') {
      const { httpStatus, body } = await listMyOrders(profile);
      return Response.json(body, { status: httpStatus });
    }

    return Response.json(
      { success: false, error: `ไม่รู้จัก action: ${action}` },
      { status: 400 }
    );
  } catch (err) {
    console.error('GET /api/orders failed:', err);
    return errorResponse(err);
  }
}

export async function POST(req) {
  try {
    const { profile } = await requireAuth(req);
    const url    = parseRequestUrl(req);
    const action = url.searchParams.get('action');

    if (action === 'create') {
      const payload = await req.json();
      const { httpStatus, body } = await createOrder(profile, payload);
      return Response.json(body, { status: httpStatus });
    }

    if (action === 'set-payment-method') {
      const payload = await req.json();
      const { httpStatus, body } = await setOrderPaymentMethod(profile, payload);
      return Response.json(body, { status: httpStatus });
    }

    return Response.json(
      { success: false, error: `ไม่รู้จัก action: ${action}` },
      { status: 400 }
    );
  } catch (err) {
    console.error('POST /api/orders failed:', err);
    return errorResponse(err);
  }
}
