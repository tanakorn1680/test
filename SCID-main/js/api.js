// ============================================================
// js/api.js — Frontend API client
// เรียก /api/* เท่านั้น ไม่แตะ Supabase โดยตรง
//
// หมายเหตุ: หลังรวม Serverless Functions เพื่อให้อยู่ในลิมิต Vercel
// Hobby Plan (≤12 functions) หลาย endpoint เดิมถูกรวมเป็น router เดียว
// แยกด้วย query param (?action=, ?resource=, ?scope=) — ดู mapping
// เต็มได้ที่ docs/API_ROUTES.md
// ============================================================

// ── Auth (Supabase JS ยังใช้สำหรับ login/register/session เท่านั้น)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL      = '__SUPABASE_URL__';
const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';

// supabase client ใช้สำหรับ Auth เท่านั้น — ไม่ query DB ตรงๆ
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// ── Helper: ดึง token จาก session ──────────────────────────
async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

// ── Helper: fetch ไป API Route ─────────────────────────────
async function apiFetch(path, options = {}) {
  const token = await getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers ?? {}),
  };

  const res = await fetch(path, { ...options, headers });
  const json = await res.json();

  if (!json.success) {
    throw new Error(json.error ?? 'เกิดข้อผิดพลาด');
  }
  return json;
}

// ── Helper: อัปโหลดไฟล์ผ่าน FormData (ต้องใช้ fetch ตรง ไม่ผ่าน apiFetch
//    เพราะ apiFetch ตั้ง Content-Type: application/json ตายตัวซึ่งชนกับ multipart)
async function uploadFetch(path, form) {
  const token = await getToken();
  const res  = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? 'อัปโหลดไม่สำเร็จ');
  return json;
}

// ── Auth ────────────────────────────────────────────────────
export const auth = {
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(mapAuthError(error));
    return data;
  },

  async register(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(mapAuthError(error));
    return data;
  },

  async logout() {
    await supabase.auth.signOut();
  },

  async getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  },

  onAuthChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
  },

  async requestPasswordReset(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/pages/reset-password.html`,
    });
    if (error) throw new Error(mapAuthError(error));
  },

  async updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(mapAuthError(error));
  },

  async resendVerification(email) {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });
    if (error) throw new Error(mapAuthError(error));
  },
};

// ── Products (รวมเข้า /api/admin/catalog-products แล้ว) ────
export const products = {
  async list() {
    return apiFetch('/api/admin/catalog-products?scope=public');
  },
};

// ── Payment Methods (รวมเข้า /api/admin/catalog-payment แล้ว) ─
export const paymentMethods = {
  async list() {
    return apiFetch('/api/admin/catalog-payment?scope=public');
  },
};

// ── Site Settings (รวมเข้า /api/admin/site-assets แล้ว) ────
export const settings = {
  async get() {
    return apiFetch('/api/admin/site-assets?resource=settings&scope=public');
  },
};

// ── Orders (รวมเข้า /api/orders แล้ว — แยกด้วย ?action=) ───
export const orders = {
  async create(productKey) {
    return apiFetch('/api/orders?action=create', {
      method: 'POST',
      body: JSON.stringify({ product_key: productKey }),
    });
  },

  async myOrders() {
    return apiFetch('/api/orders?action=my');
  },

  async detail(orderId) {
    return apiFetch(`/api/orders?action=detail&id=${orderId}`);
  },

  async setPaymentMethod(orderId, paymentMethodId) {
    return apiFetch('/api/orders?action=set-payment-method', {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId, payment_method_id: paymentMethodId }),
    });
  },

  // upload-slip รวมเข้า /api/orders/slip (คนละไฟล์จาก /api/orders เพราะ
  // FormData vs JSON — ดู _lib/handlers/order-slip.js)
  async uploadSlip(orderId, file) {
    const form = new FormData();
    form.append('order_id', orderId);
    form.append('file', file);
    return uploadFetch('/api/orders/slip', form);
  },
};

// ── Admin ───────────────────────────────────────────────────
export const admin = {
  async stats() {
    return apiFetch('/api/admin/stats');
  },

  // orders/deliver/reject รวมเข้า /api/admin/orders แล้ว — แยกด้วย method + action
  async orders({ status = null, page = 0, search = '' } = {}) {
    const params = new URLSearchParams({ page });
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    return apiFetch(`/api/admin/orders?${params}`);
  },

  async deliver(orderId) {
    return apiFetch('/api/admin/orders', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', order_id: orderId }),
    });
  },

  async reject(orderId, reason) {
    return apiFetch('/api/admin/orders', {
      method: 'POST',
      body: JSON.stringify({ action: 'reject', order_id: orderId, reason }),
    });
  },

  // slip-url รวมเข้า /api/orders/slip แล้ว (GET = แอดมินอ่าน, POST = ลูกค้าเขียน)
  async slipUrl(orderId) {
    return apiFetch(`/api/orders/slip?order_id=${orderId}`);
  },

  inventory: {
    async list({ productKey = null, status = null } = {}) {
      const params = new URLSearchParams();
      if (productKey) params.set('product_key', productKey);
      if (status)     params.set('status', status);
      return apiFetch(`/api/admin/inventory?${params}`);
    },

    async addOne({ productKey, gmail, password, instructionTitle, instructionBody }) {
      return apiFetch('/api/admin/inventory', {
        method: 'POST',
        body: JSON.stringify({
          product_key:        productKey,
          gmail,
          password,
          instruction_title:  instructionTitle  || null,
          instruction_body:   instructionBody   || null,
        }),
      });
    },

    async update(id, { gmail, password, instructionTitle, instructionBody } = {}) {
      const body = { id };
      if (gmail            !== undefined) body.gmail             = gmail;
      if (password         !== undefined) body.password          = password;
      if (instructionTitle !== undefined) body.instruction_title = instructionTitle;
      if (instructionBody  !== undefined) body.instruction_body  = instructionBody;
      return apiFetch('/api/admin/inventory', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    },

    async remove(id) {
      return apiFetch('/api/admin/inventory', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      });
    },

    // lazy-load credential (email+password) เฉพาะแถวที่กดดู
    async getCredential(id) {
      return apiFetch(`/api/admin/inventory?id=${id}`);
    },

    // force delete ไอดีที่มี order ผูกอยู่ (เช่น ไอดีทดสอบ) — admin ยืนยันแล้ว
    async forceDelete(id) {
      return apiFetch('/api/admin/inventory', {
        method: 'DELETE',
        body: JSON.stringify({ id, force: true }),
      });
    },
  },

  // products รวมเข้า /api/admin/catalog-products แล้ว (ไม่มี scope=public
  // เพราะเป็น admin path เต็มรูปแบบ)
  products: {
    async list() {
      return apiFetch('/api/admin/catalog-products');
    },

    async create(product) {
      return apiFetch('/api/admin/catalog-products', {
        method: 'POST',
        body: JSON.stringify(product),
      });
    },

    async update(id, updates) {
      return apiFetch('/api/admin/catalog-products', {
        method: 'PUT',
        body: JSON.stringify({ id, ...updates }),
      });
    },

    async remove(id) {
      return apiFetch('/api/admin/catalog-products', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      });
    },
  },

  // payment-methods รวมเข้า /api/admin/catalog-payment แล้ว
  paymentMethods: {
    async list() {
      return apiFetch('/api/admin/catalog-payment');
    },

    async create(method) {
      return apiFetch('/api/admin/catalog-payment', {
        method: 'POST',
        body: JSON.stringify(method),
      });
    },

    async update(id, updates) {
      return apiFetch('/api/admin/catalog-payment', {
        method: 'PUT',
        body: JSON.stringify({ id, ...updates }),
      });
    },

    async remove(id) {
      return apiFetch('/api/admin/catalog-payment', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      });
    },
  },

  // settings รวมเข้า /api/admin/site-assets?resource=settings แล้ว
  settings: {
    async get() {
      return apiFetch('/api/admin/site-assets?resource=settings');
    },

    async update(updates) {
      return apiFetch('/api/admin/site-assets?resource=settings', {
        method: 'PUT',
        body: JSON.stringify({ updates }),
      });
    },
  },

  async customers() {
    return apiFetch('/api/admin/customers');
  },

  // upload-asset รวมเข้า /api/admin/site-assets?resource=asset แล้ว
  async uploadAsset(assetKey, file) {
    const form = new FormData();
    form.append('asset_key', assetKey);
    form.append('file', file);
    return uploadFetch('/api/admin/site-assets?resource=asset', form);
  },

  // upload-payment-qr รวมเข้า /api/admin/site-assets?resource=payment-qr แล้ว
  async uploadPaymentQr(file) {
    const form = new FormData();
    form.append('file', file);
    return uploadFetch('/api/admin/site-assets?resource=payment-qr', form);
  },
};

// ── Map Supabase auth error → ภาษาไทย ──────────────────────
function mapAuthError(error) {
  const msg = error.message ?? '';
  if (msg.includes('Invalid login credentials')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (msg.includes('already registered'))        return 'อีเมลนี้ถูกใช้แล้ว';
  if (msg.includes('Email not confirmed'))       return 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ';
  if (msg.includes('Password should be'))        return 'รหัสผ่านไม่ตรงตามเงื่อนไขความปลอดภัย';
  if (msg.includes('rate limit'))                 return 'มีการร้องขอบ่อยเกินไป กรุณารอสักครู่';
  console.error('Auth error:', error);
  return 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}
