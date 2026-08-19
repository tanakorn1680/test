// ============================================================
// api/_lib/auth.js
// ตรวจ JWT จาก Authorization header
// คืน { user, profile } หรือ throw error
// ============================================================

import { supabaseAdmin } from './supabase.js';

/**
 * ดึง user จาก Bearer token
 * ใช้ใน API Route ทุกตัวที่ต้อง login ก่อน
 */
export async function requireAuth(req) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    throw { status: 401, message: 'กรุณาเข้าสู่ระบบ' };
  }

  // ตรวจ token กับ Supabase Auth
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    throw { status: 401, message: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' };
  }

  // ดึง profile (role)
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) {
    throw { status: 401, message: 'ไม่พบข้อมูลผู้ใช้' };
  }

  return { user, profile };
}

/**
 * เหมือน requireAuth แต่ต้องเป็น admin
 */
export async function requireAdmin(req) {
  const result = await requireAuth(req);
  if (result.profile.role !== 'admin') {
    throw { status: 403, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }
  return result;
}

/**
 * Standard error response
 */
export function errorResponse(err) {
  const status  = err.status  ?? 500;
  const message = err.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่';
  return Response.json({ success: false, error: message }, { status });
}
