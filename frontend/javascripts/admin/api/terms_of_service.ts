import Request from "libs/request";

export function getTermsOfService(): Promise<{
  content: string;
  enabled: boolean;
  version: number;
}> {
  return Request.receiveJSON("/api/termsOfService");
}

export async function requiresTermsOfServiceAcceptance(): Promise<boolean> {
  return (await Request.receiveJSON("/api/termsOfService/acceptanceNeeded")).acceptanceNeeded;
}

export function acceptTermsOfService(version: number): Promise<unknown> {
  return Request.receiveJSON(`/api/termsOfService/accept?version=${version}`, { method: "POST" });
}
