import window, { location } from "libs/window";
import Request from "libs/request";
import * as Utils from "libs/utils";
import Toast from "libs/toast";
import UrlManager from "oxalis/controller/url_manager";

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

function removeSharingTokenFromURLParameters() {
  const urlObj = new URL(window.location.href);
  if (urlObj.searchParams.has("token")) {
    urlObj.searchParams.delete("token");
    UrlManager.changeBaseUrl(urlObj.pathname + urlObj.search);
    Toast.info("Removed token from URL and trying using your user token instead...");
  }
}

export async function doWithToken<T>(
  fn: (token: string) => Promise<T>,
  tries: number = 1,
  useURLTokenIfAvailable: boolean = true,
): Promise<any> {
  let token = useURLTokenIfAvailable ? getSharingTokenFromUrlParameters() : null;

  if (token == null) {
    tokenPromise = tokenPromise == null ? requestUserToken() : tokenPromise;
  } else {
    tokenPromise = Promise.resolve(token);
  }

  return tokenPromise.then(fn).catch(async (error) => {
    if (error.status === 403) {
      console.warn("Token expired. Requesting new token...");
      tokenPromise = requestUserToken();

      // If three new tokens did not fix the 403, abort, otherwise we'll get into an endless loop here
      if (tries < 3) {
        // If using the url sharing token failed, we try the user specific token instead.
        const result = await doWithToken(fn, tries + 1, false);
        // Upon successful retry with own token, discard the url token.
        if (useURLTokenIfAvailable) {
          removeSharingTokenFromURLParameters();
        }
        return result;
      }
    }

    throw error;
  });
}
