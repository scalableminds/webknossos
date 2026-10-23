import { parseFilenameFromContentDisposition } from "libs/download";
import { describe, expect, it } from "vitest";

describe("parseFilenameFromContentDisposition", () => {
  it("returns null for missing headers or headers without filename", () => {
    expect(parseFilenameFromContentDisposition(null)).toBeNull();
    expect(parseFilenameFromContentDisposition(undefined)).toBeNull();
    expect(parseFilenameFromContentDisposition("attachment")).toBeNull();
  });

  it("parses quoted and unquoted filenames", () => {
    expect(parseFilenameFromContentDisposition('attachment; filename="project_nmls.zip"')).toBe(
      "project_nmls.zip",
    );
    expect(parseFilenameFromContentDisposition("attachment; filename=annotation.nml")).toBe(
      "annotation.nml",
    );
    expect(parseFilenameFromContentDisposition('attachment; filename="a \\"b\\".zip"')).toBe(
      'a "b".zip',
    );
  });

  it("prefers the RFC 5987 encoded filename", () => {
    expect(
      parseFilenameFromContentDisposition(
        "attachment; filename=\"M_nchen.zip\"; filename*=utf-8''M%C3%BCnchen.zip",
      ),
    ).toBe("München.zip");
  });

  it("falls back to the plain filename if the encoded one is malformed", () => {
    expect(
      parseFilenameFromContentDisposition("attachment; filename*=utf-8''%E0%A4%A; filename=x.zip"),
    ).toBe("x.zip");
  });
});
