#!/usr/bin/env node
/**
 * Shopee MCP Server — Shopee Open Platform API v2
 * Quản lý shop bán hàng: đọc shop/sản phẩm/đơn hàng + đăng bài + cập nhật giá/tồn kho.
 * Thiết kế "ai cũng dùng được": chỉ cần điền 5 biến môi trường của shop, không sửa code.
 *
 * ENV bắt buộc:
 *   SHOPEE_PARTNER_ID     - Partner ID (App ID) từ Shopee Open Platform
 *   SHOPEE_PARTNER_KEY    - Partner Key (Secret) từ Shopee Open Platform
 *   SHOPEE_SHOP_ID        - Shop ID (sau khi shop uỷ quyền)
 *   SHOPEE_ACCESS_TOKEN   - Access token của shop (lấy qua OAuth 1 lần)
 *   SHOPEE_REFRESH_TOKEN  - Refresh token (để tự làm mới access_token khi hết hạn)
 * ENV tuỳ chọn:
 *   SHOPEE_HOST           - mặc định https://partner.shopeemobile.com (live).
 *                           Dùng https://partner.test-stable.shopeemobile.com cho môi trường test.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";
import crypto from "crypto";

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY || "";
const SHOP_ID = Number(process.env.SHOPEE_SHOP_ID);
let ACCESS_TOKEN = process.env.SHOPEE_ACCESS_TOKEN || "";
let REFRESH_TOKEN = process.env.SHOPEE_REFRESH_TOKEN || "";
const HOST = process.env.SHOPEE_HOST || "https://partner.shopeemobile.com";

if (!PARTNER_ID || !PARTNER_KEY || !SHOP_ID || !ACCESS_TOKEN) {
  console.error("Error: cần SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_SHOP_ID, SHOPEE_ACCESS_TOKEN");
  process.exit(1);
}

// ---------- Ký chữ ký HMAC-SHA256 ----------
function sign(path: string, timestamp: number, useToken = true): string {
  const base = useToken
    ? `${PARTNER_ID}${path}${timestamp}${ACCESS_TOKEN}${SHOP_ID}`
    : `${PARTNER_ID}${path}${timestamp}`;
  return crypto.createHmac("sha256", PARTNER_KEY).update(base).digest("hex");
}

function buildUrl(path: string, useToken = true): string {
  const ts = Math.floor(Date.now() / 1000);
  const sig = sign(path, ts, useToken);
  const params = new URLSearchParams({
    partner_id: String(PARTNER_ID),
    timestamp: String(ts),
    sign: sig,
  });
  if (useToken) {
    params.set("access_token", ACCESS_TOKEN);
    params.set("shop_id", String(SHOP_ID));
  }
  return `${HOST}${path}?${params.toString()}`;
}

// ---------- Tự refresh access_token khi hết hạn ----------
async function refreshAccessToken(): Promise<boolean> {
  if (!REFRESH_TOKEN) return false;
  const path = "/api/v2/auth/access_token/get";
  const url = buildUrl(path, false);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: REFRESH_TOKEN, partner_id: PARTNER_ID, shop_id: SHOP_ID }),
  });
  const data: any = await res.json();
  if (data.access_token) {
    ACCESS_TOKEN = data.access_token;
    if (data.refresh_token) REFRESH_TOKEN = data.refresh_token;
    return true;
  }
  return false;
}

// ---------- Gọi API chung (tự retry khi token hết hạn) ----------
async function call(path: string, method: "GET" | "POST", body?: any, query?: Record<string, any>): Promise<any> {
  const doCall = async () => {
    let url = buildUrl(path, true);
    if (query) {
      const qp = new URLSearchParams(query as any).toString();
      url += `&${qp}`;
    }
    const opt: any = { method, headers: { "Content-Type": "application/json" } };
    if (method === "POST" && body) opt.body = JSON.stringify(body);
    const res = await fetch(url, opt);
    return res.json();
  };
  let data: any = await doCall();
  if (data && (data.error === "error_auth" || data.error === "invalid_access_token" || /token/i.test(data.error || ""))) {
    const ok = await refreshAccessToken();
    if (ok) data = await doCall();
  }
  return data;
}

// ---------- Định nghĩa Tools ----------
const TOOLS: Tool[] = [
  { name: "get_shop_info", description: "Lấy thông tin shop (tên, khu vực, loại shop, trạng thái).", inputSchema: { type: "object", properties: {} } },
  { name: "get_item_list", description: "Lấy danh sách sản phẩm của shop.", inputSchema: { type: "object", properties: { offset: { type: "number" }, page_size: { type: "number" }, item_status: { type: "string", enum: ["NORMAL","BANNED","UNLIST","SELLER_DELETE","SHOPEE_DELETE"] } } } },
  { name: "get_item_base_info", description: "Lấy chi tiết sản phẩm theo item_id.", inputSchema: { type: "object", properties: { item_id_list: { type: "array", items: { type: "number" } } }, required: ["item_id_list"] } },
  { name: "get_category", description: "Lấy cây danh mục — cần trước khi đăng bài để có category_id.", inputSchema: { type: "object", properties: { language: { type: "string" } } } },
  { name: "get_attributes", description: "Lấy thuộc tính bắt buộc của category_id — cần khi đăng bài.", inputSchema: { type: "object", properties: { category_id: { type: "number" }, language: { type: "string" } }, required: ["category_id"] } },
  { name: "upload_image", description: "Upload ảnh từ URL, trả về image_id để đăng bài.", inputSchema: { type: "object", properties: { image_url: { type: "string" } }, required: ["image_url"] } },
  { name: "add_item", description: "ĐĂNG BÀI sản phẩm mới. Cần category_id (get_category), image_id (upload_image), logistics_channel_ids (get_channel_list), attribute_list (get_attributes).", inputSchema: { type: "object", properties: { item_name: { type: "string" }, description: { type: "string" }, category_id: { type: "number" }, original_price: { type: "number" }, seller_stock: { type: "number" }, weight: { type: "number" }, image_id_list: { type: "array", items: { type: "string" } }, logistics_channel_ids: { type: "array", items: { type: "number" } }, attribute_list: { type: "array", items: { type: "object" } } }, required: ["item_name","description","category_id","original_price","seller_stock","weight","image_id_list","logistics_channel_ids"] } },
  { name: "update_item", description: "Cập nhật thông tin sản phẩm.", inputSchema: { type: "object", properties: { item_id: { type: "number" }, item_name: { type: "string" }, description: { type: "string" }, category_id: { type: "number" } }, required: ["item_id"] } },
  { name: "update_price", description: "Cập nhật giá sản phẩm.", inputSchema: { type: "object", properties: { item_id: { type: "number" }, price_list: { type: "array", items: { type: "object" } } }, required: ["item_id","price_list"] } },
  { name: "update_stock", description: "Cập nhật tồn kho.", inputSchema: { type: "object", properties: { item_id: { type: "number" }, stock_list: { type: "array", items: { type: "object" } } }, required: ["item_id","stock_list"] } },
  { name: "unlist_item", description: "Ẩn/hiện sản phẩm.", inputSchema: { type: "object", properties: { item_id: { type: "number" }, unlist: { type: "boolean" } }, required: ["item_id","unlist"] } },
  { name: "get_channel_list", description: "Lấy danh sách kênh vận chuyển — cần logistics_channel_ids khi đăng bài.", inputSchema: { type: "object", properties: {} } },
  { name: "get_order_list", description: "Lấy danh sách đơn hàng theo thời gian và trạng thái.", inputSchema: { type: "object", properties: { time_range_field: { type: "string", enum: ["create_time","update_time"] }, time_from: { type: "number" }, time_to: { type: "number" }, page_size: { type: "number" }, order_status: { type: "string", enum: ["UNPAID","READY_TO_SHIP","PROCESSED","SHIPPED","COMPLETED","IN_CANCEL","CANCELLED","TO_RETURN"] } } } },
  { name: "get_order_detail", description: "Lấy chi tiết đơn hàng theo order_sn.", inputSchema: { type: "object", properties: { order_sn_list: { type: "array", items: { type: "string" } } }, required: ["order_sn_list"] } },
];

async function handle(name: string, a: any): Promise<any> {
  switch (name) {
    case "get_shop_info": return call("/api/v2/shop/get_shop_info", "GET");
    case "get_item_list": return call("/api/v2/product/get_item_list", "GET", undefined, { offset: a.offset ?? 0, page_size: a.page_size ?? 20, item_status: a.item_status ?? "NORMAL" });
    case "get_item_base_info": return call("/api/v2/product/get_item_base_info", "GET", undefined, { item_id_list: a.item_id_list.join(",") });
    case "get_category": return call("/api/v2/product/get_category", "GET", undefined, { language: a.language ?? "vi" });
    case "get_attributes": return call("/api/v2/product/get_attributes", "GET", undefined, { category_id: a.category_id, language: a.language ?? "vi" });
    case "upload_image": return call("/api/v2/media_space/upload_image", "POST", { image_url: a.image_url });
    case "add_item": return call("/api/v2/product/add_item", "POST", { item_name: a.item_name, description: a.description, category_id: a.category_id, original_price: a.original_price, seller_stock: [{ stock: a.seller_stock }], weight: a.weight, image: { image_id_list: a.image_id_list }, logistic_info: (a.logistics_channel_ids || []).map((id: number) => ({ logistic_id: id, enabled: true })), attribute_list: a.attribute_list ?? [] });
    case "update_item": return call("/api/v2/product/update_item", "POST", { item_id: a.item_id, ...(a.item_name ? { item_name: a.item_name } : {}), ...(a.description ? { description: a.description } : {}), ...(a.category_id ? { category_id: a.category_id } : {}) });
    case "update_price": return call("/api/v2/product/update_price", "POST", { item_id: a.item_id, price_list: a.price_list });
    case "update_stock": return call("/api/v2/product/update_stock", "POST", { item_id: a.item_id, stock_list: a.stock_list });
    case "unlist_item": return call("/api/v2/product/unlist_item", "POST", { item_list: [{ item_id: a.item_id, unlist: a.unlist }] });
    case "get_channel_list": return call("/api/v2/logistics/get_channel_list", "GET");
    case "get_order_list": return call("/api/v2/order/get_order_list", "GET", undefined, { time_range_field: a.time_range_field ?? "create_time", time_from: a.time_from ?? Math.floor(Date.now()/1000)-86400, time_to: a.time_to ?? Math.floor(Date.now()/1000), page_size: a.page_size ?? 20, ...(a.order_status ? { order_status: a.order_status } : {}) });
    case "get_order_detail": return call("/api/v2/order/get_order_detail", "GET", undefined, { order_sn_list: a.order_sn_list.join(","), response_optional_fields: "item_list,recipient_address,total_amount,order_status" });
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server({ name: "shopee-mcp-server", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const { name, arguments: args } = req.params;
    const result = await handle(name, args ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Shopee MCP Server running on stdio");
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });