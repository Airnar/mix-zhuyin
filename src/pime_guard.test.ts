import { EventEmitter } from "events";

import { failedResponse, guardedResponse, installCrashGuards } from "./pime_guard";

describe("guardedResponse", () => {
  test("passes the handler's answer through", () => {
    const onError = jest.fn();
    expect(guardedResponse({ seqNum: 3 }, () => ({ return: true, seqNum: 3 }), onError)).toEqual({
      return: true,
      seqNum: 3,
    });
    expect(onError).not.toHaveBeenCalled();
  });

  test("answers 'not handled' instead of throwing, and reports the error", () => {
    const onError = jest.fn();
    const boom = new Error("boom");
    const answer = guardedResponse(
      { method: "filterKeyDown", seqNum: 7 },
      () => {
        throw boom;
      },
      onError,
    );
    expect(answer).toEqual(failedResponse({ seqNum: 7 }));
    expect(answer).toEqual({ return: false, success: true, seqNum: 7 });
    expect(onError).toHaveBeenCalledWith(boom, { method: "filterKeyDown", seqNum: 7 });
  });

  test("still answers if reporting fails too", () => {
    expect(
      guardedResponse(
        { seqNum: 1 },
        () => {
          throw new Error("boom");
        },
        () => {
          throw new Error("log broke");
        },
      ),
    ).toEqual({ return: false, success: true, seqNum: 1 });
  });
});

describe("installCrashGuards", () => {
  test("logs stray errors instead of letting them end the process", () => {
    const proc = new EventEmitter();
    const log = jest.fn();
    installCrashGuards(proc, log);
    const rejection = new Error("fetch failed");
    proc.emit("unhandledRejection", rejection);
    const exception = new Error("EPIPE");
    proc.emit("uncaughtException", exception);
    expect(log).toHaveBeenCalledWith("Unhandled rejection", rejection);
    expect(log).toHaveBeenCalledWith("Uncaught exception", exception);
  });
});
