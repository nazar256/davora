import { handleRequest } from "./app";
import { AccountStoreDurableObject } from "./accounts/durable-object";

export default {
  async fetch(request: Request, env: Record<string, unknown>) {
    return handleRequest(request, env);
  }
};

export { AccountStoreDurableObject };
