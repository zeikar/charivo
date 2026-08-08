import { describe, expect, it } from "vitest";
import {
  CharivoDisposeError,
  CharivoError,
  CharivoProviderError,
  CharivoStateError,
  CharivoTimeoutError,
  CharivoTransportError,
  isCharivoError,
  toCharivoError,
} from "@charivo/core";

const CHARIVO_ERROR_BRAND = Symbol.for("@charivo/core/CharivoError");

describe("isCharivoError", () => {
  it("returns true for each CharivoError subclass instance", () => {
    expect(isCharivoError(new CharivoError("x"))).toBe(true);
    expect(isCharivoError(new CharivoStateError("x"))).toBe(true);
    expect(isCharivoError(new CharivoTimeoutError("x"))).toBe(true);
    expect(isCharivoError(new CharivoTransportError("x"))).toBe(true);
    expect(isCharivoError(new CharivoProviderError("x"))).toBe(true);
    expect(isCharivoError(new CharivoDisposeError("x"))).toBe(true);
  });

  it("returns true for toCharivoError output", () => {
    expect(isCharivoError(toCharivoError("state", new Error("boom")))).toBe(
      true,
    );
  });

  it("returns false for a plain Error, null, and a string", () => {
    expect(isCharivoError(new Error("plain"))).toBe(false);
    expect(isCharivoError(null)).toBe(false);
    expect(isCharivoError("boom")).toBe(false);
  });

  it("recognizes a branded object from a duplicated core copy without instanceof", () => {
    const prototype = { [CHARIVO_ERROR_BRAND]: true };
    const crossCopyError = Object.assign(Object.create(prototype), {
      message: "cross-copy failure",
      code: "CHARIVO_TIMEOUT_ERROR",
    });

    expect(isCharivoError(crossCopyError)).toBe(true);
    expect(crossCopyError instanceof CharivoError).toBe(false);
  });

  it("rejects a branded object with a bogus code", () => {
    const prototype = { [CHARIVO_ERROR_BRAND]: true };
    const invalidCodeError = Object.assign(Object.create(prototype), {
      message: "bad code",
      code: "NOT_A_REAL_CODE",
    });

    expect(isCharivoError(invalidCodeError)).toBe(false);
  });

  it("rejects an object with a valid code and message but no brand", () => {
    expect(isCharivoError({ code: "CHARIVO_ERROR", message: "x" })).toBe(false);
  });

  it("rejects a branded object with a non-string message", () => {
    const prototype = { [CHARIVO_ERROR_BRAND]: true };
    const invalidMessageError = Object.assign(Object.create(prototype), {
      message: 42,
      code: "CHARIVO_ERROR",
    });

    expect(isCharivoError(invalidMessageError)).toBe(false);
  });

  it("brands the real CharivoError prototype non-enumerably", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      CharivoError.prototype,
      CHARIVO_ERROR_BRAND,
    );

    expect(descriptor).toBeDefined();
    expect(descriptor?.value).toBe(true);
    expect(descriptor?.enumerable).toBe(false);

    expect(CHARIVO_ERROR_BRAND in new CharivoError("x")).toBe(true);
    expect(CHARIVO_ERROR_BRAND in new CharivoTimeoutError("x")).toBe(true);
  });
});
