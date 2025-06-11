import * as webauthn from "@github/webauthn-json";
import { getActiveUser, getOrganization } from "admin/rest_api";
import Request from "libs/request";
import type { APIOrganization, APIUser } from "types/api_types";

export type WebAuthnKeyDescriptor = {
  id: string;
  name: string;
};

export async function doWebAuthnLogin(): Promise<[APIUser, APIOrganization]> {
  const webAuthnAuthAssertion = await Request.receiveJSON("/api/auth/webauthn/auth/start", {
    method: "POST",
  });
  const response = await webauthn.get({
    publicKey: webAuthnAuthAssertion,
  });
  await Request.sendJSONReceiveJSON("/api/auth/webauthn/auth/finalize", {
    method: "POST",
    data: { key: response },
  });

  const activeUser = await getActiveUser();
  const organization = await getOrganization(activeUser.organization);
  return [activeUser, organization];
}

export async function doWebAuthnRegistration(name: string): Promise<any> {
  const webAuthnRegistrationAssertion = await Request.receiveJSON(
    "/api/auth/webauthn/register/start",
    {
      method: "POST",
    },
  );

  const credential = await webauthn.create({
    publicKey: webAuthnRegistrationAssertion,
  });

  return Request.sendJSONReceiveJSON("/api/auth/webauthn/register/finalize", {
    data: {
      name: name,
      key: credential,
    },
    method: "POST",
  });
}

export async function listWebAuthnKeys(): Promise<Array<WebAuthnKeyDescriptor>> {
  return await Request.receiveJSON("/api/auth/webauthn/keys");
}

export async function removeWebAuthnKey(key: WebAuthnKeyDescriptor): Promise<void> {
  await Request.sendJSONReceiveArraybuffer("/api/auth/webauthn/keys", {
    method: "DELETE",
    data: key,
  });
}
