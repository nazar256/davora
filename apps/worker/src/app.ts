import { createAccountServiceForEnvironment } from "./accounts/factory";
import { configHealth, loadConfig } from "./config";
import { withCors } from "./security/http";
import { createWorkerApplicationDependencies, handleWorkerApplication } from "./http/application";
import { workerFailureResponse } from "./http/failure";
import { prepareWorkerRequest } from "./requestBootstrap";

export async function handleRequest(request: Request, rawEnv: Record<string, unknown>): Promise<Response> {
  const bootstrap = await prepareWorkerRequest(request, rawEnv, {
    inspectHealth: configHealth,
    loadEnvironment: loadConfig
  });

  let response: Response;
  if (bootstrap.kind === "respond") {
    response = bootstrap.response;
  } else {
    let accountService: ReturnType<typeof createAccountServiceForEnvironment>;
    try {
      accountService = createAccountServiceForEnvironment(bootstrap.env);
    } catch (error) {
      response = workerFailureResponse(error, "local_state_error");
      return withCors(response, bootstrap.origin, [...bootstrap.allowedOrigins]);
    }
    try {
      response = await handleWorkerApplication(
        request,
        bootstrap.route,
        bootstrap.env,
        createWorkerApplicationDependencies(bootstrap.env, accountService)
      );
    } catch (error) {
      response = workerFailureResponse(error);
    }
  }

  return withCors(response, bootstrap.origin, [...bootstrap.allowedOrigins]);
}
