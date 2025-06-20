import type { APIOrganization } from "types/api_types";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";

const dummyOrga: APIOrganization = {
  id: "dummy_orga",
  additionalInformation: "more information",
  name: "Dummy Orga",
  pricingPlan: PricingPlanEnum.Basic,
  enableAutoVerify: true,
  newUserMailingList: "dummy@example.com",
  paidUntil: 1681400966329137,
  includedUsers: 1,
  includedStorageBytes: 1200000,
  usedStorageBytes: 1000,
  creditBalance: "0.0",
  ownerName: undefined,
};

export const powerOrga: APIOrganization = {
  id: "organizationId",
  name: "Test Organization",
  additionalInformation: "",
  pricingPlan: PricingPlanEnum.Power,
  enableAutoVerify: true,
  newUserMailingList: "",
  paidUntil: 0,
  includedUsers: 1000,
  includedStorageBytes: 10000,
  usedStorageBytes: 0,
  ownerName: undefined,
  creditBalance: undefined,
};

export default dummyOrga;
