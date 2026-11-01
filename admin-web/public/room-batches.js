// Resume by replaying the same plan from offset zero: the service skips existing rooms.
export async function runRoomBatches(api, data, onProgress = () => {}) {
  let offset = 0,
    total = null,
    count = 0,
    skipped = 0;
  try {
    while (total === null || offset < total) {
      const result = await api("property/auto-rooms", {
        method: "POST",
        data: { ...data, offset },
      });
      if (
        !Number.isInteger(result.total) ||
        result.total < 1 ||
        result.total > 1000 ||
        !Number.isInteger(result.nextOffset) ||
        result.nextOffset <= offset ||
        result.nextOffset > result.total ||
        (total !== null && result.total !== total) ||
        !Number.isInteger(result.count) ||
        !Number.isInteger(result.skipped) ||
        result.count < 0 ||
        result.skipped < 0 ||
        result.count + result.skipped !== result.nextOffset - offset
      )
        throw Error("批次返回异常，请刷新后重试");
      total = result.total;
      offset = result.nextOffset;
      count += result.count;
      skipped += result.skipped;
      onProgress({ processed: offset, total, count, skipped });
    }
    return { count, skipped, total };
  } catch (error) {
    const failure = new Error(
      `已确认处理 ${offset}${total === null ? "" : " / " + total} 间（新增 ${count}，已有 ${skipped}）。${error.message}。已完成部分保留，可按原规则重试，系统自动跳过已有房间；未收到响应的批次也可能已经保存。`,
    );
    failure.progress = { processed: offset, total, count, skipped };
    throw failure;
  }
}
