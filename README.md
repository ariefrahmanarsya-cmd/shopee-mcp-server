# Shopee MCP Server

MCP server untuk **Shopee Open Platform API v2** — kelola toko Shopee Indonesia: lihat toko, produk, pesanan; **listing produk baru**; update harga & stok. Berjalan via STDIO (npx dari GitHub), dirancang agar **siapa pun bisa pakai — cukup isi kredensial toko, tanpa ubah kode**.

**15 tools:** `get_shop_info`, `get_item_list`, `get_item_base_info`, `get_category`, `get_attributes`, `upload_image`, `add_item`, `update_item`, `update_price`, `update_stock`, `unlist_item`, `get_channel_list`, `get_order_list`, `get_order_detail`.

---

## BAGIAN A — DAFTAR SHOPEE OPEN PLATFORM (ambil kredensial)

Anda membutuhkan 5 informasi: `partner_id`, `partner_key`, `shop_id`, `access_token`, `refresh_token`.

### A1. Buat akun & App
1. Buka **https://open.shopee.com** → **Log In** → **Sign up** (gunakan email bisnis).
2. Masuk ke **Console → App Management → App List → Create App**.
3. Pilih tipe akun yang sesuai (biasanya: **Seller** jika berjualan sendiri).
4. Isi nama app, deskripsi, dan **Redirect URL** (contoh: `https://example.com/callback` — catat URL ini, digunakan di langkah OAuth).
5. Setelah dibuat, buka app → catat **Partner ID** (= App ID) dan **Partner Key** (= Secret Key). Simpan Partner Key dengan aman.
6. Di dalam app, tambahkan permission (API modules): **Shop, Product, Logistics, Order, MediaSpace**.

> ⚠️ App baru biasanya perlu disetujui Shopee terlebih dahulu untuk modul write (listing produk). Bisa tes lebih dulu di environment **test-stable** sebelum ke live.

### A2. Otorisasi toko & ambil token (dijalankan 1 kali)
Setelah clone repo dan build (Bagian B), jalankan tool pengambil token:
```bash
# Langkah 1 — buat link otorisasi
SHOPEE_PARTNER_ID=123456 SHOPEE_PARTNER_KEY=shpk_xxx SHOPEE_REDIRECT_URL=https://example.com/callback \
  npm run auth -- link
```
→ Buka link yang muncul, login ke toko, klik setuju. Shopee akan redirect ke Redirect URL dengan parameter `?code=XXX&shop_id=YYY`.
```bash
# Langkah 2 — tukar code dengan token
SHOPEE_PARTNER_ID=123456 SHOPEE_PARTNER_KEY=shpk_xxx \
  npm run auth -- token XXX YYY
```
→ Akan menampilkan `SHOPEE_SHOP_ID`, `SHOPEE_ACCESS_TOKEN`, `SHOPEE_REFRESH_TOKEN`. Salin 3 nilai ini.

*(access_token expired ~4 jam — MCP otomatis refresh menggunakan refresh_token, Anda tidak perlu mengulangi langkah ini.)*

---

## BAGIAN B — INSTALASI & MENJALANKAN

### B1. Jalankan langsung dari GitHub via npx (direkomendasikan)
Tidak perlu install apapun, npx otomatis build dari GitHub. Lihat konfigurasi di Bagian C.

### B2. Jalankan lokal (untuk test / ambil token)
```bash
git clone https://github.com/ariefrahmanarsya-cmd/shopee-mcp-server.git
cd shopee-mcp-server
npm install
npm run build
```

---

## BAGIAN C — INTEGRASI KE BOB (IBM Bob AI)

Buka Bob → Settings → MCP Servers → tambah konfigurasi berikut:
```json
{
  "mcpServers": {
    "shopee": {
      "command": "npx",
      "args": ["-y", "github:ariefrahmanarsya-cmd/shopee-mcp-server"],
      "env": {
        "SHOPEE_PARTNER_ID": "123456",
        "SHOPEE_PARTNER_KEY": "shpk_xxxxxxxx",
        "SHOPEE_SHOP_ID": "222222",
        "SHOPEE_ACCESS_TOKEN": "xxxxxxxx",
        "SHOPEE_REFRESH_TOKEN": "xxxxxxxx"
      }
    }
  }
}
```
Execution Timeout: **120 detik** (build pertama via npx membutuhkan waktu lebih lama).

---

## BAGIAN D — ALUR LISTING PRODUK (add_item) — ikuti urutan ini
Listing produk di Shopee memerlukan 4 langkah berurutan:
1. `get_category` → pilih `category_id` yang sesuai kategori produk.
2. `get_attributes` dengan `category_id` tersebut → ambil atribut wajib → siapkan `attribute_list`.
3. `upload_image` dengan URL foto → dapatkan `image_id` (ulangi untuk setiap foto).
4. `get_channel_list` → dapatkan `logistics_channel_ids` yang aktif di toko.
5. `add_item` dengan semua data: item_name, description, category_id, original_price, seller_stock, weight, image_id_list, logistics_channel_ids, attribute_list.

---

## CATATAN PENTING
- **Host:** live = `https://partner.shopeemobile.com`. Test = `https://partner.test-stable.shopeemobile.com` (set via env `SHOPEE_HOST`).
- **Region:** konfigurasi ini untuk toko **Indonesia**. Bahasa default kategori: `id`.
- **Rate Limit:** MCP otomatis retry hingga 3x dengan exponential backoff jika terkena rate limit (HTTP 429). Bisa dikonfigurasi via `SHOPEE_MAX_RETRIES`.
- **Keamanan:** jangan commit Partner Key / token ke GitHub publik. Simpan hanya di env saat menjalankan.
- MCP otomatis menghitung signature HMAC-SHA256 dan refresh token — pengguna tidak perlu khawatir.

## Changelog
- **v1.1.0** — Rate limit retry (HTTP 429 + exponential backoff), bahasa default Indonesia (`id`), README Bahasa Indonesia
- **v1.0.0** — Rilis awal (fork dari Maz1n0-zzz/shopee-mcp-server)

## License
MIT
