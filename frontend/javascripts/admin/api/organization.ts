import Request from "libs/request";
import { location } from "libs/window";
import memoize from "lodash-es/memoize";
import type {
  APIOrganization,
  APIOrganizationCompact,
  APIPricingPlanStatus,
  APITeamMembership,
} from "types/api_types";
import Constants, { ControlModeEnum } from "viewer/constants";
import type { TraceOrViewCommand } from "viewer/store";

// ### Organizations
export async function getDefaultOrganization(): Promise<APIOrganization | null> {
  // Only returns an organization if the WEBKNOSSOS instance only has one organization
  return Request.receiveJSON("/api/organizations/default");
}

export function joinOrganization(inviteToken: string): Promise<void> {
  return Request.triggerRequest(`/api/auth/joinOrganization/${inviteToken}`, {
    method: "POST",
  });
}

export async function switchToOrganization(organizationId: string): Promise<void> {
  await Request.triggerRequest(`/api/auth/switchOrganization/${organizationId}`, {
    method: "POST",
  });
  location.reload();
}

export async function getUsersOrganizations(): Promise<Array<APIOrganizationCompact>> {
  const organizations: APIOrganizationCompact[] = await Request.receiveJSON(
    "/api/organizations?compact=true",
  );
  const scmOrganization = organizations.find((org) => org.id === "scalable_minds");
  if (scmOrganization == null) {
    return organizations;
  }
  // Move scalableminds organization to the front so it appears in the organization switcher
  // at the top.
  return [scmOrganization, ...organizations.filter((org) => org.id !== scmOrganization.id)];
}

export function getOrganizationByInvite(inviteToken: string): Promise<APIOrganization> {
  return Request.receiveJSON(`/api/organizations/byInvite/${inviteToken}`, {
    showErrorToast: false,
  }).then((organization) => ({
    ...organization,
    aiPlan: organization.aiPlan ?? null,
    paidUntil: organization.paidUntil ?? Constants.MAXIMUM_DATE_TIMESTAMP,
    includedStorageBytes: organization.includedStorageBytes ?? Number.POSITIVE_INFINITY,
    includedUsers: organization.includedUsers ?? Number.POSITIVE_INFINITY,
  }));
}

export function sendInvitesForOrganization(
  recipients: Array<string>,
  autoActivate: boolean,
  isAdmin: boolean,
  isDatasetManager: boolean,
  teamMemberships: APITeamMembership[],
): Promise<void> {
  return Request.sendJSONReceiveJSON("/api/auth/sendInvites", {
    method: "POST",
    data: {
      recipients,
      autoActivate,
      isAdmin,
      isDatasetManager,
      teamMemberships,
    },
  });
}

export async function getOrganization(organizationId: string): Promise<APIOrganization> {
  const organization = await Request.receiveJSON(`/api/organizations/${organizationId}`);
  return {
    ...organization,
    aiPlan: organization.aiPlan ?? null,
    paidUntil: organization.paidUntil ?? Constants.MAXIMUM_DATE_TIMESTAMP,
    includedStorageBytes: organization.includedStorageBytes ?? Number.POSITIVE_INFINITY,
    includedUsers: organization.includedUsers ?? Number.POSITIVE_INFINITY,
  };
}

export async function checkAnyOrganizationExists(): Promise<boolean> {
  return !(await Request.receiveJSON("/api/organizationsIsEmpty"));
}

export async function deleteOrganization(organizationId: string): Promise<void> {
  return Request.triggerRequest(`/api/organizations/${organizationId}`, {
    method: "DELETE",
  });
}

export async function updateOrganization(
  organizationId: string,
  name: string,
  newUserMailingList: string,
): Promise<APIOrganization> {
  const updatedOrganization = await Request.sendJSONReceiveJSON(
    `/api/organizations/${organizationId}`,
    {
      method: "PATCH",
      data: {
        name,
        newUserMailingList,
      },
    },
  );

  return {
    ...updatedOrganization,
    aiPlan: updatedOrganization.aiPlan ?? null,
    paidUntil: updatedOrganization.paidUntil ?? Constants.MAXIMUM_DATE_TIMESTAMP,
    includedStorageBytes: updatedOrganization.includedStorageBytes ?? Number.POSITIVE_INFINITY,
    includedUsers: updatedOrganization.includedUsers ?? Number.POSITIVE_INFINITY,
  };
}

export async function isDatasetAccessibleBySwitching(
  commandType: TraceOrViewCommand,
): Promise<APIOrganization | null | undefined> {
  if (commandType.type === ControlModeEnum.TRACE) {
    const organization = await Request.receiveJSON(
      `/api/auth/accessibleBySwitching?annotationId=${commandType.annotationId}`,
      {
        showErrorToast: false,
      },
    );
    if (!organization) {
      return organization;
    }
    return {
      ...organization,
      aiPlan: organization.aiPlan ?? null,
      paidUntil: organization.paidUntil ?? Constants.MAXIMUM_DATE_TIMESTAMP,
      includedStorageBytes: organization.includedStorageBytes ?? Number.POSITIVE_INFINITY,
      includedUsers: organization.includedUsers ?? Number.POSITIVE_INFINITY,
    };
  } else {
    const organization = await Request.receiveJSON(
      `/api/auth/accessibleBySwitching?datasetId=${commandType.datasetId}`,
      {
        showErrorToast: false,
      },
    );
    if (!organization) {
      return organization;
    }
    return {
      ...organization,
      aiPlan: organization.aiPlan ?? null,
      paidUntil: organization.paidUntil ?? Constants.MAXIMUM_DATE_TIMESTAMP,
      includedStorageBytes: organization.includedStorageBytes ?? Number.POSITIVE_INFINITY,
      includedUsers: organization.includedUsers ?? Number.POSITIVE_INFINITY,
    };
  }
}

export async function isWorkflowAccessibleBySwitching(
  workflowHash: string,
): Promise<APIOrganization | null> {
  const organization = await Request.receiveJSON(
    `/api/auth/accessibleBySwitching?workflowHash=${workflowHash}`,
  );
  if (!organization) {
    return organization;
  }
  return {
    ...organization,
    aiPlan: organization.aiPlan ?? null,
    paidUntil: organization.paidUntil ?? Constants.MAXIMUM_DATE_TIMESTAMP,
    includedStorageBytes: organization.includedStorageBytes ?? Number.POSITIVE_INFINITY,
    includedUsers: organization.includedUsers ?? Number.POSITIVE_INFINITY,
  };
}

export async function sendUpgradePricingPlanEmail(requestedPlan: string): Promise<void> {
  return Request.receiveJSON(`/api/pricing/requestUpgrade?requestedPlan=${requestedPlan}`, {
    method: "POST",
  });
}

export async function sendExtendPricingPlanEmail(): Promise<void> {
  return Request.receiveJSON("/api/pricing/requestExtension", {
    method: "POST",
  });
}

export async function sendUpgradePricingPlanUserEmail(requestedUsers: number): Promise<void> {
  return Request.receiveJSON(`/api/pricing/requestUsers?requestedUsers=${requestedUsers}`, {
    method: "POST",
  });
}

export async function sendUpgradePricingPlanStorageEmail(requestedStorage: number): Promise<void> {
  return Request.receiveJSON(`/api/pricing/requestStorage?requestedStorage=${requestedStorage}`, {
    method: "POST",
  });
}

export async function sendOrderCreditsEmail(requestedCredits: number): Promise<void> {
  return Request.receiveJSON(`/api/pricing/requestCredits?requestedCredits=${requestedCredits}`, {
    method: "POST",
  });
}

export async function sendUpgradeAiAddonEmail(): Promise<void> {
  return Request.receiveJSON("/api/pricing/requestAiAddon", {
    method: "POST",
  });
}

export async function getPricingPlanStatus(): Promise<APIPricingPlanStatus> {
  return Request.receiveJSON("/api/pricing/status");
}

export const cachedGetPricingPlanStatus = memoize(getPricingPlanStatus);
