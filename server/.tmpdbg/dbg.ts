import { fixture } from "../test/helpers.js";
const service = await fixture();
const user = await service.auth.identity(service.credential());
console.log("identity", user);
const assistant = service.runtime.assistant(user);
console.log("assistant", assistant.name, assistant.tool_names);
console.log("all", (await service.registry.all()).map((t) => [t.name, t.permission, service.registry.setting(t)]));
console.log("permitted", (await service.registry.permitted(user, assistant)).map((t) => t.name));
await service.close();
