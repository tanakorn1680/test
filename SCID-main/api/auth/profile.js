// GET /api/auth/profile
// คืน profile ของ user ที่ login อยู่ (รวม role)

import { requireAuth, errorResponse } from '../_lib/auth.js';

export const config = { runtime: "nodejs" };

export async function GET(req) {
  try {
    const { profile } = await requireAuth(req);
    return Response.json({ success: true, data: profile });
  } catch (err) {
    return errorResponse(err);
  }
}
