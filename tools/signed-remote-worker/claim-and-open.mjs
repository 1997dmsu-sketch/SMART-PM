import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { main } from "./worker-runtime.mjs";

export { main };
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
