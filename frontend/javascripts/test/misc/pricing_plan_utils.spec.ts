import {
  formatStorage,
  getPlanEndLabel,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import { formatMilliCreditsString } from "libs/format_utils";
import type { APIOrganization } from "types/api_types";
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

describe("formatMilliCreditsString", () => {
  it("formats whole and fractional credits with thousands separators", () => {
    expect(formatMilliCreditsString(0)).toBe("0");
    expect(formatMilliCreditsString(5000)).toBe("5");
    expect(formatMilliCreditsString(1500)).toBe("1.5");
    expect(formatMilliCreditsString(1001)).toBe("1.001");
    expect(formatMilliCreditsString(1000000)).toBe("1,000");
    expect(formatMilliCreditsString(1234500)).toBe("1,234.5");
  });

  it("formats negative balances", () => {
    expect(formatMilliCreditsString(-500)).toBe("-0.5");
    expect(formatMilliCreditsString(-2000000)).toBe("-2,000");
  });
});

describe("getPlanEndLabel", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const organization = (pricingPlan: PricingPlanEnum, paidUntil: number) =>
    ({ pricingPlan, paidUntil }) as APIOrganization;

  it("says paid until / expired on for paid plans", () => {
    expect(getPlanEndLabel(organization(PricingPlanEnum.Team, Date.now() + DAY))).toBe(
      "paid until",
    );
    expect(getPlanEndLabel(organization(PricingPlanEnum.Power, Date.now() - DAY))).toBe(
      "expired on",
    );
  });

  it("says ends on / ended on for trials", () => {
    expect(getPlanEndLabel(organization(PricingPlanEnum.TeamTrial, Date.now() + DAY))).toBe(
      "ends on",
    );
    expect(getPlanEndLabel(organization(PricingPlanEnum.PowerTrial, Date.now() - DAY))).toBe(
      "ended on",
    );
  });
});
