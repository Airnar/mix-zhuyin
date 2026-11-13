/**
 * Keeps the PIME backend alive through errors. NIME has no try/catch around
 * requests, so one throw ends node; the launcher then restarts the backend and
 * the text service drops the input method's buttons (the icon and the menu
 * vanish until the app reconnects).
 */

/** What PIME answers for a request that failed: the key is not handled. */
export interface FailedResponse {
  return: false;
  success: true;
  seqNum: unknown;
}

/**
 * The answer for a request that could not be handled.
 * @param request The request.
 * @returns A response that lets the key through to the app.
 */
export const failedResponse = (request: { seqNum?: unknown }): FailedResponse => ({
  return: false,
  success: true,
  seqNum: request?.seqNum,
});

/**
 * Answers a request, or, if the handler throws, reports the error and answers
 * that the request was not handled.
 * @param request The request.
 * @param handle Answers the request.
 * @param onError Told about an error, with the request; its own errors are
 *   ignored.
 * @returns The handler's answer, or `failedResponse`.
 */
export const guardedResponse = <Request extends { seqNum?: unknown }, Response>(
  request: Request,
  handle: (request: Request) => Response,
  onError: (error: unknown, request: Request) => void,
): Response | FailedResponse => {
  try {
    return handle(request);
  } catch (e) {
    try {
      onError(e, request);
    } catch {
      // Nothing more to do; the answer matters more than the report.
    }
    return failedResponse(request);
  }
};

/** The part of `process` the guards use. */
export interface ProcessLike {
  on(event: string, listener: (error: unknown) => void): unknown;
}

/**
 * Logs errors that happen outside a request (timers, file watchers, network)
 * instead of letting them end the process.
 * @param proc The process.
 * @param log Writes the error, e.g. to stderr, which the launcher logs.
 */
export const installCrashGuards = (
  proc: ProcessLike,
  log: (what: string, error: unknown) => void,
): void => {
  proc.on("unhandledRejection", (e) => log("Unhandled rejection", e));
  proc.on("uncaughtException", (e) => log("Uncaught exception", e));
};
