import type { INotice } from "@airbrake/browser";
import {
  getPrefixedErrorMessage,
  moveOriginalErrorToNoticeErrors,
  ORIGINAL_ERROR_PARAM,
} from "libs/airbrake_notice_helpers";
import { describe, expect, it } from "vitest";

const backtrace = [{ function: "f", file: "a.ts", line: 1, column: 2 }];

describe("getPrefixedErrorMessage", () => {
  it("should truncate the message used for grouping but keep the full message", () => {
    const error = new TypeError(`Failed to fetch - Url: https://example.org/${"a".repeat(200)}`);
    const { prefixedMessage, fullMessage } = getPrefixedErrorMessage("Prefix: ", error);

    expect(prefixedMessage).toBe(`Prefix: ${error.toString().slice(0, 80)}`);
    expect(fullMessage).toBe(error.toString());
  });

  it("should stringify non-errors", () => {
    const { prefixedMessage, fullMessage } = getPrefixedErrorMessage("Prefix: ", { a: 1 });

    expect(prefixedMessage).toBe('Prefix: {"a":1}');
    expect(fullMessage).toBe('{"a":1}');
  });
});

describe("moveOriginalErrorToNoticeErrors", () => {
  it("should move the original error from the params into an additional error", () => {
    const fullMessage = `TypeError: Failed to fetch - Url: https://example.org/${"a".repeat(200)}`;
    const notice: INotice = {
      errors: [{ type: "TypeError", message: "Prefix: TypeError: Failed", backtrace }],
      params: { [ORIGINAL_ERROR_PARAM]: fullMessage, other: 1 },
    };

    const result = moveOriginalErrorToNoticeErrors(notice);

    expect(result.params).toEqual({ other: 1 });
    expect(result.errors).toEqual([
      { type: "TypeError", message: "Prefix: TypeError: Failed", backtrace },
      { type: "OriginalError", message: fullMessage, backtrace },
    ]);
  });

  it("should not change the first error, which is used for grouping", () => {
    const notice: INotice = {
      errors: [{ type: "TypeError", message: "Prefix: short", backtrace }],
      params: { [ORIGINAL_ERROR_PARAM]: "TypeError: short but different" },
    };

    const result = moveOriginalErrorToNoticeErrors(notice);

    expect(result.errors?.[0]).toEqual({ type: "TypeError", message: "Prefix: short", backtrace });
  });

  it("should not add a duplicate error if the message is identical", () => {
    const notice: INotice = {
      errors: [{ type: "Error", message: "same", backtrace }],
      params: { [ORIGINAL_ERROR_PARAM]: "same" },
    };

    const result = moveOriginalErrorToNoticeErrors(notice);

    expect(result.errors).toHaveLength(1);
    expect(result.params).toEqual({});
  });

  it("should leave notices without original error untouched", () => {
    const notice: INotice = {
      errors: [{ type: "Error", message: "a", backtrace }],
      params: { other: 1 },
    };

    expect(moveOriginalErrorToNoticeErrors(notice)).toEqual({
      errors: [{ type: "Error", message: "a", backtrace }],
      params: { other: 1 },
    });
  });
});
