#!/bin/bash
# inject-env.sh — แทนที่ placeholder ด้วย env var จริงตอน Vercel build
# Vercel Environment Variables ที่ต้องตั้ง:
#   SUPABASE_URL              = https://xxxx.supabase.co
#   SUPABASE_ANON_KEY         = eyJ...
#   SUPABASE_SERVICE_ROLE_KEY = eyJ...  (ใช้ใน API routes ฝั่ง server เท่านั้น)
#   ENCRYPTION_KEY            = 64 hex chars (openssl rand -hex 32)

set -e

# ตรวจ env vars ครบหรือยัง
for VAR in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY ENCRYPTION_KEY; do
  if [ -z "${!VAR}" ]; then
    echo "ERROR: $VAR is not set in Vercel Environment Variables"
    exit 1
  fi
done

# ตรวจ ENCRYPTION_KEY ต้องยาว 64 hex chars
if [ ${#ENCRYPTION_KEY} -ne 64 ]; then
  echo "ERROR: ENCRYPTION_KEY must be 64 hex characters (run: openssl rand -hex 32)"
  exit 1
fi

echo "Injecting environment variables..."

# inject ลง js/api.js (frontend — ใช้แค่ SUPABASE_URL และ SUPABASE_ANON_KEY)
sed -i \
  -e "s|__SUPABASE_URL__|${SUPABASE_URL}|g" \
  -e "s|__SUPABASE_ANON_KEY__|${SUPABASE_ANON_KEY}|g" \
  js/api.js

echo "Done"
