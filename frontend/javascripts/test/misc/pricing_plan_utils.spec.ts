import {
  areJobsAllowedByPricingPlan,
  isAiAddonEligiblePlan,
  isAiQuickSelectAllowedByPricingPlan,
  isFeatureAllowedByPricingPlan,
  isJobAvailable,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import dummyOrga from "test/fixtures/dummy_organization";
import { type APIDataStore, APIJobCommand, type APIOrganization } from "types/api_types";
import { describe, expect, it } from "vitest";

// Encodes the feature matrix of https://home.webknossos.org/pricing for the features that are gated by plan.
// The page does not list Enterprise. It unlocks all features of Power, with unlimited users and storage.
// Trials unlock the same features as their paid counterparts.

const ALL_PLANS = Object.values(PricingPlanEnum);

function orgWithPlan(pricingPlan: PricingPlanEnum): APIOrganization {
  return { ...dummyOrga, pricingPlan };
}

function plansWith(isAllowed: (organization: APIOrganization) => boolean): PricingPlanEnum[] {
  return ALL_PLANS.filter((plan) => isAllowed(orgWithPlan(plan)));
}

const dataStoreWithWorker: APIDataStore = {
  name: "localhost",
  url: "http://localhost:9000",
  allowsUpload: true,
  jobsEnabled: true,
  jobsSupportedByAvailableWorkers: [APIJobCommand.RENDER_ANIMATION, APIJobCommand.INFER_NEURONS],
};

describe("Pricing plans", () => {
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
