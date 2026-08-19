// api/admin/catalog-products.js
// Router เท่านั้น — business logic อยู่ที่ _lib/handlers/
//
// GET    ?scope=public                        → public list (ไม่ต้อง login)
// GET                                         → admin list สินค้าทั้งหมด
// GET    ?resource=product-image&product_key= → list รูปของสินค้า
// POST                                        → create product (JSON)
// POST   ?resource=product-image             → upload รูป (FormData)
// PATCH  ?resource=product-image             → reorder รูป (JSON) ← ลำดับ 0 = ปกอัตโนมัติ
// PUT                                         → update product (JSON)
// DELETE                                      → delete product (JSON)
// DELETE ?resource=product-image             → ลบรูป (JSON)
//
// ⚠️ scope=public ต้องเช็คก่อน requireAdmin เสมอ

import { requireAdmin, errorResponse } from '../_lib/auth.js';
import {
  publicListProducts,
  adminListProducts,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
} from '../_lib/handlers/catalog-products.js';
import {
  adminListImages,
  adminUploadImage,
  adminDeleteImage,
  adminSetCover,
  adminReorderImages,
} from '../_lib/handlers/catalog-product-images.js';
import { parseRequestUrl } from '../_lib/request-url.js';

export const config = { runtime: 'nodejs' };

// ─────────────────────────────────────────────────────────────
export async function GET(req) {
  const url = parseRequestUrl(req);

  // ── public path: ไม่ต้อง auth ──
  if (url.searchParams.get('scope') === 'public') {
    try {
      const { httpStatus, body } = await publicListProducts();
      return Response.json(body, { status: httpStatus });
    } catch (err) {
      console.error('GET catalog-products?scope=public failed:', err);
      return Response.json({ success: false, error: 'โหลดสินค้าไม่สำเร็จ' }, { status: 500 });
    }
  }

  // ── admin เท่านั้น ──
  try {
    await requireAdmin(req);

    if (url.searchParams.get('resource') === 'product-image') {
      const product_key = url.searchParams.get('product_key');
      const { httpStatus, body } = await adminListImages({ product_key });
      return Response.json(body, { status: httpStatus });
    }

    const { httpStatus, body } = await adminListProducts();
    return Response.json(body, { status: httpStatus });
  } catch (err) {
    console.error('GET catalog-products (admin) failed:', err);
    return errorResponse(err);
  }
}

// ─────────────────────────────────────────────────────────────
export async function POST(req) {
  try {
    await requireAdmin(req);
    const url = parseRequestUrl(req);

    if (url.searchParams.get('resource') === 'product-image') {
      const form = await req.formData();
      const { httpStatus, body } = await adminUploadImage(form);
      return Response.json(body, { status: httpStatus });
    }

    const payload = await req.json();
    const { httpStatus, body } = await adminCreateProduct(payload);
    return Response.json(body, { status: httpStatus });
  } catch (err) {
    console.error('POST catalog-products failed:', err);
    return errorResponse(err);
  }
}

// ─────────────────────────────────────────────────────────────
// PATCH — เรียงลำดับรูปภาพ · ลำดับ sort_order=0 = ปกอัตโนมัติ
export async function PATCH(req) {
  try {
    await requireAdmin(req);
    const url = parseRequestUrl(req);

    if (url.searchParams.get('resource') === 'product-image') {
      const payload = await req.json();
      const { httpStatus, body } = await adminReorderImages(payload);
      return Response.json(body, { status: httpStatus });
    }

    return Response.json({ success: false, error: 'ไม่รู้จัก resource' }, { status: 400 });
  } catch (err) {
    console.error('PATCH catalog-products failed:', err);
    return errorResponse(err);
  }
}

// ─────────────────────────────────────────────────────────────
export async function PUT(req) {
  try {
    await requireAdmin(req);
    const url = parseRequestUrl(req);

    if (url.searchParams.get('resource') === 'product-image') {
      const payload = await req.json();
      const { httpStatus, body } = await adminSetCover(payload);
      return Response.json(body, { status: httpStatus });
    }

    const payload = await req.json();
    const { httpStatus, body } = await adminUpdateProduct(payload);
    return Response.json(body, { status: httpStatus });
  } catch (err) {
    console.error('PUT catalog-products failed:', err);
    return errorResponse(err);
  }
}

// ─────────────────────────────────────────────────────────────
export async function DELETE(req) {
  try {
    await requireAdmin(req);
    const url = parseRequestUrl(req);

    if (url.searchParams.get('resource') === 'product-image') {
      const payload = await req.json();
      const { httpStatus, body } = await adminDeleteImage(payload);
      return Response.json(body, { status: httpStatus });
    }

    const payload = await req.json();
    const { httpStatus, body } = await adminDeleteProduct(payload);
    return Response.json(body, { status: httpStatus });
  } catch (err) {
    console.error('DELETE catalog-products failed:', err);
    return errorResponse(err);
  }
}
