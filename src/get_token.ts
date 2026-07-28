#!/usr/bin/env node
/**
 * Công cụ lấy ACCESS_TOKEN + REFRESH_TOKEN cho shop (chạy 1 lần trên máy bạn).
 * Cách dùng:
 *   Bước 1: SHOPEE_PARTNER_ID=... SHOPEE_PARTNER_KEY=... node build/get_token.js link
 *           -> in ra link uỷ quyền. Mở link, đăng nhập shop, đồng ý.
 *           -> Shopee redirect về REDIRECT_URL kèm ?code=...&shop_id=...
 *   Bước 2: SHOPEE_PARTNER_ID=... SHOPEE_PARTNER_KEY=... node build/get_token.js token <code> <shop_id>
 *           -> in ra access_token + refresh_token để điền vào ENV của MCP.
 *
 * ENV:
 *   SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY bắt buộc.
 *   SHOPEE_REDIRECT_URL (mặc định https://example.com/callback) — phải khớp Redirect URL khai trong App.
 *   SHOPEE_HOST (mặc định live).
 */
import crypto from "crypto";

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY || "";
const REDIRECT = process.env.SHOPEE_REDIRECT_URL || "https://example.com/callback";
const HOST = process.env.SHOPEE_HOST || "https://partner.shopeemobile.com";

function signPublic(path: string, ts: number): string {
  return crypto.createHmac("sha256", PARTNER_KEY).update(`${PARTNER_ID}${path}${ts}`).digest("hex");
}

async function main() {
  const [cmd, code, shopId] = process.argv.slice(2);
  if (!PARTNER_ID || !PARTNER_KEY) { console.error("Cần SHOPEE_PARTNER_ID và SHOPEE_PARTNER_KEY"); process.exit(1); }

  if (cmd === "link") {
    const path = "/api/v2/shop/auth_partner";
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPublic(path, ts);
    const url = `${HOST}${path}?partner_id=${PARTNER_ID}&timestamp=${ts}&sign=${sig}&redirect=${encodeURIComponent(REDIRECT)}`;
    console.log("\n>>> Mở link này trên trình duyệt, đăng nhập shop và đồng ý uỷ quyền:\n");
    console.log(url);
    console.log("\nSau khi đồng ý, Shopee sẽ chuyển tới REDIRECT_URL kèm ?code=...&shop_id=...");
    console.log("Copy code + shop_id rồi chạy: node build/get_token.js token <code> <shop_id>\n");
    return;
  }

  if (cmd === "token") {
    if (!code || !shopId) { console.error("Dùng: node build/get_token.js token <code> <shop_id>"); process.exit(1); }
    const path = "/api/v2/auth/token/get";
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPublic(path, ts);
    const url = `${HOST}${path}?partner_id=${PARTNER_ID}&timestamp=${ts}&sign=${sig}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, partner_id: PARTNER_ID, shop_id: Number(shopId) }),
    });
    const data: any = await res.json();
    if (data.access_token) {
      console.log("\n=== THÀNH CÔNG — điền vào ENV của MCP ===");
      console.log("SHOPEE_SHOP_ID =", shopId);
      console.log("SHOPEE_ACCESS_TOKEN =", data.access_token);
      console.log("SHOPEE_REFRESH_TOKEN =", data.refresh_token);
      console.log("(access_token hết hạn sau ~4 giờ; MCP tự refresh bằng refresh_token)\n");
    } else {
      console.log("Lỗi:", JSON.stringify(data, null, 2));
    }
    return;
  }

  console.error("Lệnh không hợp lệ. Dùng 'link' hoặc 'token <code> <shop_id>'.");
}
main().catch((e) => { console.error(e); process.exit(1); });