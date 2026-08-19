// api/_lib/file-validation.js
// ตรวจชนิดไฟล์จาก magic bytes จริง (ป้องกัน spoofing ผ่านนามสกุลไฟล์/MIME type ปลอม)
// ใช้ร่วมกันระหว่าง upload-slip.js และ upload-asset.js

const ALLOWED_SIGNATURES = [
  { bytes: [0xFF, 0xD8, 0xFF],       ext: 'jpg'  },  // JPEG
  { bytes: [0x89, 0x50, 0x4E, 0x47], ext: 'png'  },  // PNG
  { bytes: [0x52, 0x49, 0x46, 0x46], ext: 'webp', check: 'webp' }, // WEBP
];

export function detectImageType(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer.slice(0, 12));

  for (const sig of ALLOWED_SIGNATURES) {
    const match = sig.bytes.every((b, i) => bytes[i] === b);
    if (!match) continue;

    if (sig.check === 'webp') {
      const webp = String.fromCharCode(...bytes.slice(8, 12));
      if (webp !== 'WEBP') continue;
    }
    return sig.ext;
  }
  return null;
}
