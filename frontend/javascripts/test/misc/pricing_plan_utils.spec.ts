import { formatStorage } from "admin/organization/pricing_plan_utils";
import { Unicode } from "viewer/constants";
import { describe, expect, it } from "vitest";

const { ThinSpace } = Unicode;

describe("formatStorage", () => {
  it("keeps round amounts in their natural unit without a trailing .0", () => {
    expect(formatStorage(100e9)).toBe(`100${ThinSpace}GB`);
    expect(formatStorage(1e12)).toBe(`1${ThinSpace}TB`);
    expect(formatStorage(1.5e12)).toBe(`1.5${ThinSpace}TB`);
  });

  it("rounds down so usage just below a limit doesn't read as the limit", () => {
    expect(formatStorage(1.96e12)).toBe(`1.9${ThinSpace}TB`);
    expect(formatStorage(999.96e9)).toBe(`999.9${ThinSpace}GB`);
    expect(formatStorage(960e9)).toBe(`960${ThinSpace}GB`);
  });

  it("formats small and unlimited amounts", () => {
    expect(formatStorage(0)).toBe(`0${ThinSpace}B`);
    expect(formatStorage(512)).toBe(`512${ThinSpace}B`);
    expect(formatStorage(Number.POSITIVE_INFINITY)).toBe("∞");
  });
});
