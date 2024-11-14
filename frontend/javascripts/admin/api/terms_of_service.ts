import Request from "libs/request";

export function getTermsOfService(): Promise<{
  url: string;
  enabled: boolean;
  version: number;
}> {
  return Request.receiveJSON("/api/termsOfService");
}
