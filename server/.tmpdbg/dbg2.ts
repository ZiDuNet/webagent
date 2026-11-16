import { fixture, mockServer } from "../test/helpers.js";
const upstream = await mockServer();
const service = await fixture(upstream.baseUrl);
const session = await service.session();
const result = await (await service.runs.start(service.credential(), { session_id: session.id, message: "你好" })).task;
console.log("status", result.status);
console.log(upstream.requests.map((r) => ({ path: r.path, stream: r.stream, keys: Object.keys(r) })));
await service.close();
await upstream.close();
