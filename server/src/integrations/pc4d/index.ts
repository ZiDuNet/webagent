import { createWebAgent, type AppOptions } from "../../app.js";
import { Store } from "../../store.js";
import { Pc4dConnector, type Pc4dOptions, type Pc4dTool } from "./connector.js";
import { pc4dRoutes } from "./routes.js";
import catalogue from "./catalogue.json" with { type: "json" };

export async function createPc4dAgent(options: Pc4dOptions & AppOptions = {}) {
  const store = options.store || new Store();
  const connector = new Pc4dConnector(store, options);
  connector.initialize(catalogue as Pc4dTool[]);
  const service = await createWebAgent({ ...options, store, identityAdapter: connector, tools: [...connector.tools(), ...options.tools || []] });
  pc4dRoutes(service.app, connector, service.auth, store);
  if (!options.store) service.app.addHook("onClose", async () => store.close());
  return { ...service, connector };
}
