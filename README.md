# Shopee MCP Server

MCP server cho **Shopee Open Platform API v2** — quản lý shop bán hàng: xem shop, sản phẩm, đơn hàng; **đăng bài sản phẩm**; cập nhật giá & tồn kho. Chạy dạng STDIO (npx từ GitHub), thiết kế để **ai cũng dùng được — chỉ cần điền thông tin shop, không sửa code**.

15 tools: `get_shop_info`, `get_item_list`, `get_item_base_info`, `get_category`, `get_attributes`, `upload_image`, `add_item`, `update_item`, `update_price`, `update_stock`, `unlist_item`, `get_channel_list`, `get_order_list`, `get_order_detail`.

---

## PHẦN A — ĐĂNG KÝ SHOPEE OPEN PLATFORM (lấy credential)

Bạn cần 5 thông tin: `partner_id`, `partner_key`, `shop_id`, `access_token`, `refresh_token`.

### A1. Tạo tài khoản & App
1. Vào **https://open.shopee.com** → **Log In** → **Sign up** (dùng email doanh nghiệp).
2. Vào **Console → App Management → App List → Create App**.
3. Chọn loại tài khoản phù hợp (thường: **Seller** nếu bán hàng, hoặc **ISV** nếu làm dịch vụ cho nhiều shop).
4. Điền tên app, mô tả, và **Redirect URL** (ví dụ `https://example.com/callback` — nhớ URL này, dùng ở bước OAuth).
5. Sau khi tạo, mở app → lấy **Partner ID** (= App ID) và **Partner Key** (= Secret Key). Lưu Partner Key an toàn (Shopee ít hiện lại).
6. Trong app, thêm quyền (API modules) cần dùng: **Shop, Product, Logistics, Order, MediaSpace**.

> ⚠️ App mới thường phải chờ Shopee duyệt/kích hoạt các module ghi (đăng bài). Có thể test trước trên môi trường **test-stable** trước khi lên live.

### A2. Uỷ quyền shop & lấy token (chạy 1 lần)
Sau khi clone repo và build (Phần B), chạy công cụ lấy token:
```bash
# Bước 1 — sinh link uỷ quyền
SHOPEE_PARTNER_ID=123456 SHOPEE_PARTNER_KEY=shpk_xxx SHOPEE_REDIRECT_URL=https://example.com/callback \
  npm run auth -- link
```
→ Mở link in ra, đăng nhập shop, bấm đồng ý. Shopee chuyển về Redirect URL kèm `?code=XXX&shop_id=YYY`.
```bash
# Bước 2 — đổi code lấy token
SHOPEE_PARTNER_ID=123456 SHOPEE_PARTNER_KEY=shpk_xxx \
  npm run auth -- token XXX YYY
```
→ In ra `SHOPEE_SHOP_ID`, `SHOPEE_ACCESS_TOKEN`, `SHOPEE_REFRESH_TOKEN`. Copy 3 giá trị này.

*(access_token hết hạn ~4 giờ — MCP tự refresh bằng refresh_token, bạn không cần làm lại bước này.)*

---

## PHẦN B — CÀI & CHẠY

### B1. Chạy trực tiếp từ GitHub bằng npx (khuyên dùng cho Evose)
Không cần cài gì, npx tự build từ GitHub. Xem cấu hình import ở PHẦN C.

### B2. Chạy local (để test / lấy token)
```bash
git clone https://github.com/<user>/shopee-mcp-server.git
cd shopee-mcp-server
npm install
npm run build
```

---

## PHẦN C — TÍCH HỢP VÀO EVOSE (STDIO npx)

Vào Evose → thêm MCP mới → Import Configuration via JSON, dán:
```json
{
  "mcpServers": {
    "shopee": {
      "command": "npx",
      "args": ["-y", "github:<user>/shopee-mcp-server"],
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
Hoặc điền tay theo form: Server Type = **STDIO**, Command Tool = **npx**, Command Parameters = `-y github:<user>/shopee-mcp-server`, rồi thêm 5 Environment Variables ở trên. Execution Timeout để **120s** (lần đầu npx build hơi lâu).

*(Thay `<user>` bằng GitHub username của bạn sau khi push repo lên.)*

---

## PHẦN D — QUY TRÌNH ĐĂNG BÀI (add_item) — làm đúng thứ tự
Đăng bài Shopee phức tạp hơn Etsy, cần 4 bước:
1. `get_category` → chọn `category_id` đúng ngành hàng.
2. `get_attributes` với `category_id` đó → lấy các thuộc tính bắt buộc → chuẩn bị `attribute_list`.
3. `upload_image` với URL ảnh → lấy `image_id` (làm nhiều lần cho nhiều ảnh).
4. `get_channel_list` → lấy `logistics_channel_ids` shop đang bật.
5. `add_item` với đủ: item_name, description, category_id, original_price, seller_stock, weight, image_id_list, logistics_channel_ids, attribute_list.

---

## GHI CHÚ QUAN TRỌNG
- **Host:** live = `https://partner.shopeemobile.com`. Test = `https://partner.test-stable.shopeemobile.com` (đặt qua env `SHOPEE_HOST`).
- **Vùng:** cấu hình này cho shop **Việt Nam**.
- **Bảo mật:** không commit Partner Key / token lên GitHub công khai. Chỉ để trong env khi chạy.
- MCP tự tính chữ ký HMAC-SHA256 và tự refresh token — người dùng không cần bận tâm.

## License
MIT