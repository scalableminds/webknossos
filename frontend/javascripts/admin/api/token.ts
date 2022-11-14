import { location } from "libs/window";
import Request from "libs/request";
import * as Utils from "libs/utils";

let tokenPromise: Promise<string>;

let tokenRequestPromise: Promise<string> | null;

function requestUserToken(): Promise<string> {
  if (tokenRequestPromise) {
    return tokenRequestPromise;
  }

  tokenRequestPromise = Request.receiveJSON("/api/userToken/generate", {
    method: "POST",
  }).then((tokenObj) => {
    tokenRequestPromise = null;
    return tokenObj.token as string;
  });

  return tokenRequestPromise;
}

export function getSharingTokenFromUrlParameters(): string | null | undefined {
  if (location != null) {
    const params = Utils.getUrlParamsObject();

    if (params?.token != null) {
      return params.token;
    }
  }

  return null;
}

export function doWithToken<T>(fn: (token: string) => Promise<T>, tries: number = 1): Promise<any> {
  const sharingToken = getSharingTokenFromUrlParameters();

  if (sharingToken != null) {
    return fn(sharingToken);
  }

  if (!tokenPromise) tokenPromise = requestUserToken();
  return tokenPromise.then(fn).catch((error) => {
    if (error.status === 403) {
      console.warn("Token expired. Requesting new token...");
      tokenPromise = requestUserToken();

      // If three new tokens did not fix the 403, abort, otherwise we'll get into an endless loop here
      if (tries < 3) {
        return doWithToken(fn, tries + 1);
      }
    }

    throw error;
  });
}
