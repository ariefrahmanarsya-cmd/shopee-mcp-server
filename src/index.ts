#!/usr/bin/env node
/**
 * Shopee MCP Server — Shopee Open Platform API v2
 * Manage your Shopee shop: read shop/products/orders + add items + update price/stock.
 * Designed for easy use: just fill in 5 environment variables, no code changes needed.
 *
 * Required ENV:
 *   SHOPEE_PARTNER_ID     - Partner ID (App ID) from Shopee Open Platform
 *   SHOPEE_PARTNER_KEY    - Partner Key (Secret) from Shopee Open Platform
 *   SHOPEE_SHOP_ID        - Shop ID (after shop authorization)
 *   SHOPEE_ACCESS_TOKEN   - Shop access token (obtained via OAuth once)
 *   SHOPEE_REFRESH_TOKEN  - Refresh token (used to auto-renew access_token when expired)
 * Optional ENV:
 *   SHOPEE_HOST           - default https://partner.shopeemobile.com (live/Indonesia)
 *                           Use https://partner.test-stable.shopeemobile.com for test environment.
 *   SHOPEE_MAX_RETRIES    - max retries on rate limit (default: 3)
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
const MAX_RETRIES = Number(process.env.SHOPEE_MAX_RETRIES ?? 3);

// ---------- HMAC-SHA256 Signature ----------
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

// ---------- Sleep helper ----------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Auto-refresh access_token when expired ----------
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

// ---------- Generic API call with rate limit retry + token refresh ----------
async function call(path: string, method: "GET" | "POST", body?: any, query?: Record<string, any>): Promise<any> {
  const doCall = async () => {
    let url = buildUrl(path, true);
    if (query) {
      const qp = new URLSearchParams(query as any).toString();
      url += `&${qp}`;
    }
    const opt: any = { method, headers: { "Content-Type": "application/json" } };
    if (method === "POST" && body) opt.body = JSON.stringify(body);
    return fetch(url, opt);
  };

  let attempt = 0;
  while (true) {
    const res = await doCall();

    // Rate limit — exponential backoff
    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) {
        return { error: "rate_limit_exceeded", message: `Rate limited after ${MAX_RETRIES} retries. Please wait before retrying.` };
      }
      const retryAfter = Number(res.headers.get("Retry-After") ?? 0);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 30000);
      console.error(`[shopee-mcp] Rate limited (429). Waiting ${waitMs}ms before retry ${attempt + 1}/${MAX_RETRIES}...`);
      await sleep(waitMs);
      attempt++;
      continue;
    }

    const data: any = await res.json();

    // Token expired — refresh once then retry
    if (data && (data.error === "error_auth" || data.error === "invalid_access_token" || /token/i.test(data.error || ""))) {
      const ok = await refreshAccessToken();
      if (ok) {
        const res2 = await doCall();
        return res2.json();
      }
    }

    return data;
  }
}

// ---------- Tool definitions ----------
const TOOLS: Tool[] = [
  { name: "get_shop_info", description: "Get shop information (name, region, shop type, status).", inputSchema: { type: "object", properties: {} } },
  { name: "get_item_list", description: "Get list of shop products.", inputSchema: { type: "object", properties: { offset: { type: "number" }, page_size: { type: "number" }, item_status: { type: "string", enum: ["NORMAL","BANNED","UNLIST","SELLER_DELETE","SHOPEE_DELETE"] } } } },
  { name: "get_item_base_info", description: "Get product details by item_id.", inputSchema: { type: "object", properties: { item_id_list: { type: "array", items: { type: "number" } } }, required: ["item_id_list"] } },
  { name: "get_category", description: "Get category tree — needed before listing a product to get category_id.", inputSchema: { type: "object", properties: { language: { type: "string" } } } },
  { name: "get_attributes", description: "Get required attributes for a category_id — needed when listing a product.", inputSchema: { type: "object", properties: { category_id: { type: "number" }, language: { type: "string" } }, required: ["category_id"] } },
  { name: "upload_image", description: "Upload image from URL, returns image_id for product listing.", inputSchema: { type: "object", properties: { image_url: { type: "string" } }, required: ["image_url"] } },
  { name: "add_item", description: "LIST a new product. Requires category_id (get_category), image_id (upload_image), logistics_channel_ids (get_channel_list), attribute_list (get_attributes).", inputSchema: { type: "object", properties: { item_name: { type: "string" }, description: { type: "string" }, category_id: { type: "number" }, original_price: { type: "number" }, seller_stock: { type: "number" }, weight: { type: "number" }, image_id_list: { type: "array", items: { type: "string" } }, logistics_channel_ids: { type: "array", items: { type: "number" } }, attribute_list: { type: "array", items: { type: "object" } } }, required: ["item_name","description","category_id","original_price","seller_stock","weight","image_id_list","logistics_channel_ids"] } },
  { name: "update_item", description: "Update product information.", inputSchema: { type: "object", properties: { item_id: { type: "number" }, item_name: { type: "string" }, description: { type: "string" }, category_id: { type: "number" } }, required: ["item_id"] } },
  { name: "update_price", description: "Update product price.", inputSchema: { type: "object", properties: { item_id: { type: "number" }, price_list: { type: "array", items: { type: "object" } } }, required: ["item_id","price_list"] } },
  { name: "update_stock", description: "Update product stock.", inputSchema: { type: "object", properties: { item_id: { type: "number" }, stock_list: { type: "array", items: { type: "object" } } }, required: ["item_id","stock_list"] } },
  { name: "unlist_item", description: "Hide/show a product.", inputSchema: { type: "object", properties: { item_id: { type: "number" }, unlist: { type: "boolean" } }, required: ["item_id","unlist"] } },
  { name: "get_channel_list", description: "Get available shipping channels — needed for logistics_channel_ids when listing.", inputSchema: { type: "object", properties: {} } },
  { name: "get_order_list", description: "Get list of orders by time range and status.", inputSchema: { type: "object", properties: { time_range_field: { type: "string", enum: ["create_time","update_time"] }, time_from: { type: "number" }, time_to: { type: "number" }, page_size: { type: "number" }, order_status: { type: "string", enum: ["UNPAID","READY_TO_SHIP","PROCESSED","SHIPPED","COMPLETED","IN_CANCEL","CANCELLED","TO_RETURN"] } } } },
  { name: "get_order_detail", description: "Get order details by order_sn.", inputSchema: { type: "object", properties: { order_sn_list: { type: "array", items: { type: "string" } } }, required: ["order_sn_list"] } },
];

async function handle(name: string, a: any): Promise<any> {
  switch (name) {
    case "get_shop_info": return call("/api/v2/shop/get_shop_info", "GET");
    case "get_item_list": return call("/api/v2/product/get_item_list", "GET", undefined, { offset: a.offset ?? 0, page_size: a.page_size ?? 20, item_status: a.item_status ?? "NORMAL" });
    case "get_item_base_info": return call("/api/v2/product/get_item_base_info", "GET", undefined, { item_id_list: a.item_id_list.join(",") });
    case "get_category": return call("/api/v2/product/get_category", "GET", undefined, { language: a.language ?? "id" });
    case "get_attributes": return call("/api/v2/product/get_attributes", "GET", undefined, { category_id: a.category_id, language: a.language ?? "id" });
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

const server = new Server({ name: "shopee-mcp-server", version: "1.1.0" }, { capabilities: { tools: {} } });
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
  console.error("Shopee MCP Server v1.1.0 running on stdio");
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
