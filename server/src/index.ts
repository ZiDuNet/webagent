import { createWebAgent } from "./app.js";
import { config } from "./config.js";

const { app } = await createWebAgent();
// A single failed background promise (for example an intentionally aborted
// realtime speech stream) must not take the whole API process down.
process.on("unhandledRejection", (reason) => {
  console.error("[webagent] unhandled rejection:", reason);
});
for (const event of ["SIGINT", "SIGTERM"] as const) process.once(event, async () => { await app.close(); process.exit(0); });
await app.listen({ host: config.host, port: config.port });
console.log(`WebAgent PI · 管理端 http://${config.host}:${config.port}/admin/ · Chat http://${config.host}:${config.port}/chat/`);
