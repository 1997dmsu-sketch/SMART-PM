"use strict";
(async () => {
  let blocked = false;
  try {
    await globalThis.fetch("http://127.0.0.1:9/");
  } catch (error) {
    blocked = error.code === "H4C_GUARD_BLOCKED";
  }
  const guard = globalThis.__H4C_GUARD__;
  const payload = {
    blocked,
    active: Boolean(guard && guard.active),
    network_attempts: guard ? guard.counters.network_attempts : -1,
    listen_calls: guard ? guard.counters.listen_calls : -1,
  };
  console.log(JSON.stringify(payload));
  if (!blocked || !payload.active) process.exit(1);
})();
