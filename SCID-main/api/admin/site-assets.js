// api/admin/site-assets.js
// Router เท่านั้น — business logic อยู่ที่ _lib/handlers/site-settings.js
// และ _lib/handlers/site-assets-upload.js
//
// GET  /api/admin/site-assets?resource=settings&scope=public   → public (แทน /api/settings เดิม)
// GET  /api/admin/site-assets?resource=settings                → admin
// PUT  /api/admin/site-assets?resource=settings                → admin แก้ settings
// POST /api/admin/site-assets?resource=asset                   → admin อัปโหลด logo/banner
// POST /api/admin/site-assets?resource=payment-qr               → admin อัปโหลด QR ช่องทางชำระเงิน
//
// ⚠️ resource=settings&scope=public ต้องเช็คก่อน requireAdmin เสมอ

import { requireAdmin, errorResponse } from '../_lib/auth.js';
import {
  publicGetSettings,
  adminGetSettings,
  adminPutSettings,
} from '../_lib/handlers/site-settings.js';
import {
  uploadSiteAsset,
  uploadPaymentQr,
} from '../_lib/handlers/site-assets-upload.js';
import { parseRequestUrl } from '../_lib/request-url.js';

export const config = { runtime: "nodejs" };

export async function GET(req) {
  const url      = parseRequestUrl(req);
  const resource = url.searchParams.get('resource') || 'settings';

  // ── public: อ่าน settings ไม่ต้อง login ──
  if (resource === 'settings' && url.searchParams.get('scope') === 'public') {
    try {
      const { httpStatus, body } = await publicGetSettings();
      return Response.json(body, { status: httpStatus });
    } catch (err) {
      console.error('GET /api/admin/site-assets?resource=settings&scope=public failed:', err);
      return Response.json({ success: false, error: 'โหลดการตั้งค่าไม่สำเร็จ' }, { status: 500 });
    }
  }

  // ── admin เท่านั้น ──
  try {
    await requireAdmin(req);

    if (resource === 'settings') {
      const { httpStatus, body } = await adminGetSettings();
      return Response.json(body, { status: httpStatus });
    }

    return Response.json({ success: false, error: `ไม่รู้จัก resource: ${resource}` }, { status: 400 });

  } catch (err) {
    console.error(`GET /api/admin/site-assets?resource=${resource} failed:`, err);
    return errorResponse(err);
  }
}

export async function PUT(req) {
  const url      = parseRequestUrl(req);
  const resource = url.searchParams.get('resource') || 'settings';

  try {
    await requireAdmin(req);

    if (resource === 'settings') {
      const payload = await req.json();
      const { httpStatus, body } = await adminPutSettings(payload);
      return Response.json(body, { status: httpStatus });
    }

    return Response.json({ success: false, error: `ไม่รู้จัก resource: ${resource}` }, { status: 400 });

  } catch (err) {
    console.error(`PUT /api/admin/site-assets?resource=${resource} failed:`, err);
    return errorResponse(err);
  }
}

export async function POST(req) {
  const url      = parseRequestUrl(req);
  const resource = url.searchParams.get('resource') || 'settings';

  try {
    await requireAdmin(req);

    if (resource === 'asset') {
      const form = await req.formData();
      const { httpStatus, body } = await uploadSiteAsset(form);
      return Response.json(body, { status: httpStatus });
    }

    if (resource === 'payment-qr') {
      const form = await req.formData();
      const { httpStatus, body } = await uploadPaymentQr(form);
      return Response.json(body, { status: httpStatus });
    }

    return Response.json({ success: false, error: `ไม่รู้จัก resource: ${resource}` }, { status: 400 });

  } catch (err) {
    console.error(`POST /api/admin/site-assets?resource=${resource} failed:`, err);
    return errorResponse(err);
  }
}
