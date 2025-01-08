import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import type { APIOrganization } from "types/api_flow_types";

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
  ownerName: undefined,
};

export default dummyOrga;
