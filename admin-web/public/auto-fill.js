const bad = (message) => {
  const error = new Error(message);
  error.status = 400;
  throw error;
};
function integer(value, label, min, max) {
  const n = Number(value);
  if (
    value === "" ||
    value == null ||
    !Number.isInteger(n) ||
    n < min ||
    n > max
  )
    bad(`${label}需为 ${min}–${max} 的整数`);
  return n;
}
export function floorPlan(input) {
  const start = integer(input.start, "起始楼层", -10, 200),
    end = integer(input.end, "结束楼层", -10, 200);
  if (end < start || end - start >= 50)
    bad("每次最多生成 50 层，结束层不能小于起始层");
  const skip = new Set(
    String(input.skip || "")
      .split(/[,，\s]+/)
      .filter(Boolean)
      .map((v) => integer(v, "跳过楼层", -10, 200)),
  );
  const template = String(input.template || "{n}层");
  if (!template.includes("{n}") || template.length > 50)
    bad("楼层名称需包含 {n}，例如 {n}层");
  const result = [];
  for (let n = start; n <= end; n++)
    if (!skip.has(n))
      result.push({ level: n, name: template.replaceAll("{n}", String(n)) });
  if (!result.length) bad("没有可生成的楼层");
  return result;
}
export function roomPlan(input, floors) {
  const start = integer(input.start, "起始楼层", -10, 200),
    end = integer(input.end, "结束楼层", -10, 200);
  if (end < start || end - start >= 100) bad("每次最多选择 100 层");
  const count = integer(input.count, "每层生成数量", 1, 1000),
    first = integer(input.first, "房号起始序号", 0, 9999),
    digits = integer(input.digits, "房号序号位数", 1, 4);
  if (first + count - 1 >= 10 ** digits)
    bad("房间序号超出位数，请增加序号位数");
  const prefix = String(input.prefix || "").trim();
  if (!/^[A-Za-z0-9_-]{0,8}$/.test(prefix))
    bad("前缀最多 8 位，只支持字母、数字、下划线和连字符");
  const skip = new Set(
    String(input.skip || "")
      .split(/[,，\s]+/)
      .filter(Boolean),
  );
  const result = [];
  for (let level = start; level <= end; level++) {
    const floor = floors.find(
      (f) =>
        f.kind === "floor" &&
        f.parentId === input.buildingId &&
        f.level === level,
    );
    if (!floor) bad(`${level} 层尚未创建，请先添加楼层，或缩小范围`);
    const label = level < 0 ? "B" + Math.abs(level) : String(level);
    for (let i = first; i < first + count; i++) {
      const number = prefix + label + String(i).padStart(digits, "0");
      if (!skip.has(number)) {
        result.push({ floorId: floor._id, floorName: floor.name, number });
        if (result.length > 1000)
          bad("每次最多生成 1000 间，请缩小楼层范围或每层数量");
      }
    }
  }
  if (!result.length) bad("没有可生成的房间");

  return result;
}
