import Request from "libs/request";
import { getUrlParamsObject } from "libs/utils";
import { location } from "libs/window";

const MAX_TOKEN_RETRY_ATTEMPTS = 3;

let tokenPromise: Promise<string>;

let tokenRequestPromise: Promise<string> | null;
let shouldUseURLToken: boolean = true;

function getOrCreateNewTokenPromise(): Promise<string> {
  /*
   * This function requests a new user token unless
   * there is already an ongoing request for a new
   * token (tokenRequestPromise != null).
   * The returned promise will contain the new token.
   */
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

export function refreshToken() {
  /*
   * This function can be used to invalidate an existing token.
   * It returns a promise that will contain a new token.
   */
  // Note that tokenPromise is a module variable and will be
  // used in doWithToken.
  tokenPromise = getOrCreateNewTokenPromise();
  return tokenPromise;
}

export function getSharingTokenFromUrlParameters(): string | null | undefined {
  if (location != null) {
    const params = getUrlParamsObject();

    if (params?.token != null) {
      return params.token;
    }
  }

  return null;
}

export async function doWithToken<T>(
  fn: (token: string) => Promise<T>,
  tries: number = 1,
  useURLTokenIfAvailable: boolean = true,
): Promise<T> {
  let token =
    useURLTokenIfAvailable && shouldUseURLToken ? getSharingTokenFromUrlParameters() : null;

  if (token == null) {
    tokenPromise = tokenPromise ?? getOrCreateNewTokenPromise();
  } else {
    tokenPromise = Promise.resolve(token);
  }

  return tokenPromise.then(fn).catch(async (error) => {
    if (error.status === 403) {
      console.warn(
        `Token expired (attempt ${tries}/${MAX_TOKEN_RETRY_ATTEMPTS}). Requesting new token...`,
      );
      refreshToken();

      // If three new tokens did not fix the 403, abort, otherwise we'll get into an endless loop here
      if (tries < MAX_TOKEN_RETRY_ATTEMPTS) {
        // If using the url sharing token failed, we try the user specific token instead.
        const result = await doWithToken(fn, tries + 1, false);
        // Upon successful retry with own token, discard the url token.
        if (useURLTokenIfAvailable) {
          shouldUseURLToken = false;
        }
        return result;
      }
    }

    throw error;
  });
}
