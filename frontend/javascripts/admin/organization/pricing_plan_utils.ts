import { APIUser } from "types/api_flow_types";
import { PricingPlanEnum } from "./organization_edit_view";

export const teamPlanFeatures = [
  "Collaborative Annotation",
  "Project Management",
  "Dataset Management and Access Control",
  "5 Users / 1TB Storage (upgradable)",
  "Priority Email Support",
  "Everything from Free plan",
];
export const powerPlanFeatures = [
  "Unlimited Users",
  "Segmentation Proof-Reading Tool",
  "On-premise or dedicated hosting solutions available",
  "Integration with your HPC and storage servers",
  "Everything from Team and Free plans",
];

export const maxInludedUsersInFreePlan = 3;
export const storageWarningThresholdMB = PricingPlanEnum.Free ? 5000 : 10000;

export function getActiveUserCount(users: APIUser[]): number {
  return users.filter((user) => user.isActive && !user.isSuperUser).length;
}
