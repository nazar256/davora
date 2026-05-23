import { handleRequest } from "./app";

export default {
  async fetch(request: Request, env: Record<string, string | undefined>) {
    return handleRequest(request, env);
  }
};
