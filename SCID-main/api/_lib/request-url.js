// api/_lib/request-url.js
// Helper สำหรับ parse req.url ให้ถูกต้องบน Vercel Node.js Runtime
//
// ⚠️ สำคัญมาก: บน Vercel, req.url ที่ handler ได้รับเป็น RELATIVE PATH
// เท่านั้น (เช่น "/api/admin/orders?status=pending") ไม่ใช่ full URL
// การเรียก `new URL(req.url)` ตรงๆ จะ throw TypeError: Invalid URL
// (ERR_INVALID_URL) เสมอ เพราะ URL constructor ต้องการ absolute URL
//
// วิธีแก้ตามเอกสารทางการของ Vercel: ต้องส่ง base URL เป็น argument
// ที่สอง โดยประกอบจาก req.headers.host
// อ้างอิง: https://vercel.com/docs/functions/runtimes/node-js
//
// ไฟล์นี้มีไว้เพื่อไม่ให้ทุก route ต้องเขียน logic นี้ซ้ำเอง (และพลาดซ้ำ)
// — ทุกไฟล์ที่ต้อง parse query string ให้ import จากที่นี่แทน new URL() ตรงๆ

export function parseRequestUrl(req) {
  const host = req.headers.get?.('host') ?? req.headers.host ?? 'localhost';
  return new URL(req.url, `http://${host}`);
}
