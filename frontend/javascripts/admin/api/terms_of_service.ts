import Request from "libs/request";

export function getTermsOfService(): Promise<{
  url: string;
  enabled: boolean;
  version: number;
}> {
  return Request.receiveJSON("/api/termsOfService");
}

export type AcceptanceInfo = {
  acceptanceDeadline: number;
  acceptanceDeadlinePassed: boolean;
  acceptanceNeeded: boolean;
};

export async function requiresTermsOfServiceAcceptance(): Promise<AcceptanceInfo> {
  return await Request.receiveJSON("/api/termsOfService/acceptanceNeeded");
}

export function acceptTermsOfService(version: number): Promise<unknown> {
  return Request.receiveJSON(`/api/termsOfService/accept?version=${version}`, { method: "POST" });
}
