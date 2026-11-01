export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (message, status = 400) => {
  throw new HttpError(status, message);
};
export const resources = ["houses", "content", "users", "rooms"];
export function authorize(role, resource, write = false) {
  if (!["admin", "editor", "viewer"].includes(role)) fail("无管理权限", 403);
  if (
    write &&
    (role === "viewer" ||
      (role === "editor" &&
        !["houses", "content", "uploads"].includes(resource)))
  )
    fail("当前角色没有此操作权限", 403);
  if (["accounts", "audit"].includes(resource) && role !== "admin")
    fail("仅系统管理员可访问", 403);
}
function str(v, label, max = 200, required = false) {
  if (typeof v !== "string") fail(`${label}格式错误`);
  v = v.trim();
  if (v.length > max || (required && !v))
    fail(`${label}${required ? "不能为空，且" : ""}最多 ${max} 字`);
  return v;
}
function num(v, label, min = 0, max = 1e8) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    fail(`${label}超出允许范围`);
  return v;
}
function choice(v, values, label) {
  if (!values.includes(v)) fail(`${label}选项无效`);
  return v;
}
export function imageURL(v) {
  v = str(v, "图片地址", 1200);
  if (
    v &&
    !/^https:\/\/[^\s]+$|^cloud:\/\/[^\s]+$|^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$|^\/assets\/room-[123]\.jpg$/.test(
      v,
    )
  )
    fail("图片仅支持 HTTPS、云存储地址或本地上传图片");
  return v;
}
export function validate(resource, data) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    fail("提交数据格式错误");
  // Field allowlists prevent editing identity, roles, or arbitrary database fields.
  if (resource === "houses")
    return {
      title: str(data.title, "房源标题", 100, true),
      community: str(data.community, "小区", 80, true),
      address: str(data.address || "", "地址"),
      price: num(data.price, "月租金"),
      area: num(data.area, "面积", 1, 100000),
      rooms: str(data.rooms, "户型", 40, true),
      orientation: str(data.orientation || "", "朝向", 20),
      rentType: choice(data.rentType, ["整租", "合租"], "租赁方式"),
      status: choice(data.status, ["在租", "已租", "下架"], "状态"),
      description: str(data.description || "", "描述", 5000),
      cover: imageURL(data.cover || ""),
      images: (Array.isArray(data.images) ? data.images : [])
        .slice(0, 12)
        .map(imageURL),
      tags: (Array.isArray(data.tags) ? data.tags : [])
        .slice(0, 8)
        .map((t) => str(t, "标签", 20)),
    };
  if (resource === "content")
    return {
      title: str(data.title, "标题", 100, true),
      type: choice(data.type, ["share", "house"], "内容分类"),
      description: str(data.description || "", "正文", 5000),
      image: imageURL(data.image || ""),
      author: str(data.author || "物业服务中心", "发布人", 50),
      enabled:
        typeof data.enabled === "boolean" ? data.enabled : fail("发布状态错误"),
      sortOrder: num(data.sortOrder, "排序", 0, 999999),
    };
  if (resource === "rooms")
    return {
      houseId: str(data.houseId, "房产编号", 80, true),
      name: str(data.name, "房产名称", 100, true),
      community: str(data.community || "", "小区", 80),
      address: str(data.address || "", "地址"),
      sortOrder: num(data.sortOrder || 0, "排序", 0, 999999),
    };
  if (resource === "users") return { name: str(data.name, "姓名", 80, true) };
  fail("未知资源", 404);
}
export function publicRecord(resource, row) {
  if (resource !== "users") return row;
  return Object.fromEntries(
    [
      "_id",
      "name",
      "nickname",
      "phone",
      "houses",
      "housesManaged",
      "createdAt",
      "lastLoginAt",
    ]
      .filter((k) => k in row)
      .map((k) => [k, row[k]]),
  );
}
export function filterRows(
  rows,
  { q = "", status = "", page = 1, pageSize = 10 } = {},
) {
  q = String(q).trim().toLowerCase();
  page = Number(page);
  pageSize = Number(pageSize);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    fail("分页参数无效");
  const matched = rows.filter(
    (r) =>
      (!q ||
        [
          r.title,
          r.name,
          r.nickname,
          r.phone,
          r.community,
          r.address,
          r.houseId,
          r.actor,
          r.action,
          r.target,
        ].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(q),
        )) &&
      (!status || String(r.status ?? r.enabled) === status),
  );
  return {
    rows: matched.slice((page - 1) * pageSize, page * pageSize),
    total: matched.length,
    page,
    pageSize,
  };
}
