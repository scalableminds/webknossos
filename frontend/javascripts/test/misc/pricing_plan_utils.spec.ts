import {
  areJobsAllowedByPricingPlan,
  formatStorage,
  getPlanEndLabel,
  isAiAddonEligiblePlan,
  isAiQuickSelectAllowedByPricingPlan,
  isFeatureAllowedByPricingPlan,
  isJobAvailable,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import { formatMilliCreditsString } from "libs/format_utils";
import dummyOrga from "test/fixtures/dummy_organization";
import { type APIDataStore, APIJobCommand, type APIOrganization } from "types/api_types";
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

// Encodes the feature matrix of https://home.webknossos.org/pricing for the features that are gated by plan.
// The page does not list Enterprise. It unlocks all features of Power, with unlimited users and storage.
// Trials unlock the same features as their paid counterparts.
describe("Pricing plans", () => {
  const ALL_PLANS = Object.values(PricingPlanEnum);

  const orgWithPlan = (pricingPlan: PricingPlanEnum): APIOrganization => ({
    ...dummyOrga,
    pricingPlan,
  });

  const plansWith = (isAllowed: (organization: APIOrganization) => boolean): PricingPlanEnum[] =>
    ALL_PLANS.filter((plan) => isAllowed(orgWithPlan(plan)));

  const dataStoreWithWorker: APIDataStore = {
    name: "localhost",
    url: "http://localhost:9000",
    allowsUpload: true,
    jobsEnabled: true,
    jobsSupportedByAvailableWorkers: [APIJobCommand.RENDER_ANIMATION, APIJobCommand.INFER_NEURONS],
  };

  it("should unlock collaboration, project and dataset management for Team and up, including Open-Source", () => {
    expect(
      plansWith((organization) =>
        isFeatureAllowedByPricingPlan(organization, PricingPlanEnum.Team),
      ).sort(),
    ).toEqual(
      [
        PricingPlanEnum.Team,
        PricingPlanEnum.TeamTrial,
        PricingPlanEnum.Power,
        PricingPlanEnum.PowerTrial,
        PricingPlanEnum.OpenSource,
        PricingPlanEnum.Enterprise,
      ].sort(),
    );
  });

  it("should unlock connectomics proofreading for Power and Enterprise only", () => {
    expect(
      plansWith((organization) =>
        isFeatureAllowedByPricingPlan(organization, PricingPlanEnum.Power),
      ).sort(),
    ).toEqual(
      [PricingPlanEnum.Power, PricingPlanEnum.PowerTrial, PricingPlanEnum.Enterprise].sort(),
    );
  });

  it("should allow the AI-based quick-select tool for all plans except Open-Source", () => {
    expect(plansWith(isAiQuickSelectAllowedByPricingPlan)).toEqual(
      ALL_PLANS.filter((plan) => plan !== PricingPlanEnum.OpenSource),
    );
  });

  it("should allow worker jobs (AI analysis, animations, precomputed meshes, conversions) for all plans except Open-Source", () => {
    expect(plansWith(areJobsAllowedByPricingPlan)).toEqual(
      ALL_PLANS.filter((plan) => plan !== PricingPlanEnum.OpenSource),
    );
  });

  it("should make jobs available only if the plan allows them and a worker supports them", () => {
    const personalOrga = orgWithPlan(PricingPlanEnum.Personal);
    expect(isJobAvailable(dataStoreWithWorker, APIJobCommand.RENDER_ANIMATION, personalOrga)).toBe(
      true,
    );
    expect(isJobAvailable(dataStoreWithWorker, APIJobCommand.EXPORT_TIFF, personalOrga)).toBe(
      false,
    );
    expect(
      isJobAvailable(
        dataStoreWithWorker,
        APIJobCommand.INFER_NEURONS,
        orgWithPlan(PricingPlanEnum.OpenSource),
      ),
    ).toBe(false);
  });

  it("should make Team, Power and Enterprise eligible for the AI add-on, but not Personal and Open-Source", () => {
    expect(ALL_PLANS.filter(isAiAddonEligiblePlan).sort()).toEqual(
      [
        PricingPlanEnum.Team,
        PricingPlanEnum.TeamTrial,
        PricingPlanEnum.Power,
        PricingPlanEnum.PowerTrial,
        PricingPlanEnum.Enterprise,
      ].sort(),
    );
  });
});
