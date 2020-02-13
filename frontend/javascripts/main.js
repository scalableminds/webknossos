/**
 * main.js
 * @flow
 */

// const zipFileRaw: string = require("url-loader!../speed-src.wasm");
// const [match, contentType, base64] = zipFileRaw.match(/^data:(.+);base64,(.*)$/);

// // Convert the base64 to a Blob
// // Souce: https://stackoverflow.com/a/20151856/626911
// const file = base64toBlob(base64, contentType);

// // Construct a 'change' event with file Blob
// const event: any = { type: "change", target: { files: [file] } };

import "es6-promise";
import "whatwg-fetch";

import "../stylesheets/main.less";

import { Provider } from "react-redux";
import React from "react";
import ReactDOM from "react-dom";

import { document } from "libs/window";
import { getActiveUser, checkAnyOrganizationExists } from "admin/admin_rest_api";
import { googleAnalyticsLogClicks } from "oxalis/model/helpers/analytics";
import { load as loadFeatureToggles } from "features";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { setHasOrganizationsAction } from "oxalis/model/actions/ui_actions";
import ErrorHandling from "libs/error_handling";
import Router from "router";
import Store from "oxalis/throttled_store";

async function loadActiveUser() {
  // Try to retreive the currently active user if logged in
  try {
    const user = await getActiveUser({ showErrorToast: false });
    Store.dispatch(setActiveUserAction(user));
    ErrorHandling.setCurrentUser(user);
  } catch (e) {
    // pass
  }
}

async function loadHasOrganizations() {
  // Check whether any organizations exist
  try {
    const hasOrganizations = await checkAnyOrganizationExists();
    Store.dispatch(setHasOrganizationsAction(hasOrganizations));
  } catch (e) {
    // pass
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  ErrorHandling.initialize({ throwAssertions: false, sendLocalErrors: false });

  document.addEventListener("click", googleAnalyticsLogClicks);
  await Promise.all([loadFeatureToggles(), loadActiveUser(), loadHasOrganizations()]);

  const containerElement = document.getElementById("main-container");
  if (containerElement) {
    ReactDOM.render(
      <Provider store={Store}>
        <Router />
      </Provider>,
      containerElement,
    );
  }
});

import zfp from "speed-src.js";
import zfpModule from "speed-src.wasm";

// Since webpack will change the name and potentially the path of the
// `.wasm` file, we have to provide a `locateFile()` hook to redirect
// to the appropriate URL.
// More details: https://kripken.github.io/emscripten-site/docs/api_reference/module.html
const module = zfp({
  locateFile(path) {
    if (path.endsWith(".wasm")) {
      return zfpModule;
    }
    return path;
  },
});

module.onRuntimeInitialized = () => {
  console.log(module._fib(12));
};
