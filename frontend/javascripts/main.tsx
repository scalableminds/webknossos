import { Provider } from "react-redux";
import React from "react";
import ReactDOM from "react-dom";
import window, { document } from "libs/window";
import rootSaga from "oxalis/model/sagas/root_saga";
import UnthrottledStore, { startSagas } from "oxalis/store";
import { message } from "antd";

import { getActiveUser, checkAnyOrganizationExists, getOrganization } from "admin/admin_rest_api";
import { googleAnalyticsLogClicks } from "oxalis/model/helpers/analytics";
import { load as loadFeatureToggles } from "features";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { setHasOrganizationsAction, setThemeAction } from "oxalis/model/actions/ui_actions";
import ErrorHandling from "libs/error_handling";
import Router from "router";
import Store from "oxalis/throttled_store";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import UserLocalStorage from "libs/user_local_storage";
import { compress, decompress } from "lz-string";
import ErrorBoundary from "components/error_boundary";
import { setStore, setModel } from "oxalis/singletons";
import Model from "oxalis/model";
import { setupApi } from "oxalis/api/internal_api";
import { setActiveOrganizationAction } from "oxalis/model/actions/organization_actions";
import checkBrowserFeatures from "libs/browser_feature_check";

import "../stylesheets/main.less";
import GlobalThemeProvider, { getThemeFromUser } from "theme";

// Suppress warning emitted by Olvy because it tries to eagerly initialize
window.OlvyConfig = null;

setModel(Model);
setStore(UnthrottledStore);
setupApi();
startSagas(rootSaga);

const reactQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      cacheTime: Infinity,
    },
  },
});

const localStoragePersister = createSyncStoragePersister({
  storage: UserLocalStorage,
  serialize: (data) => compress(JSON.stringify(data)),
  deserialize: (data) => JSON.parse(decompress(data) || "{}"),
  key: "query-cache-v3",
});

async function loadActiveUser() {
  // Try to retreive the currently active user if logged in
  try {
    const user = await getActiveUser({
      showErrorToast: false,
    });
    Store.dispatch(setActiveUserAction(user));
    Store.dispatch(setThemeAction(getThemeFromUser(user)));
    ErrorHandling.setCurrentUser(user);
    persistQueryClient({
      queryClient: reactQueryClient,
      persister: localStoragePersister,
    });
  } catch (_e) {
    // pass
  }
}

async function loadHasOrganizations() {
  // Check whether any organizations exist
  try {
    const hasOrganizations = await checkAnyOrganizationExists();
    Store.dispatch(setHasOrganizationsAction(hasOrganizations));
  } catch (_e) {
    // pass
  }
}

async function loadOrganization() {
  const { activeUser } = Store.getState();
  if (activeUser) {
    // organization can only be loaded for user with a logged in wk account
    // anonymous wk session for publicly shared datasets have no orga
    const organization = await getOrganization(activeUser.organization);
    Store.dispatch(setActiveOrganizationAction(organization));
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  ErrorHandling.initialize({
    throwAssertions: false,
  });
  message.config({ top: 30 });
  document.addEventListener("click", googleAnalyticsLogClicks);
  checkBrowserFeatures();
  await Promise.all([loadFeatureToggles(), loadActiveUser(), loadHasOrganizations()]);
  await Promise.all([loadOrganization()]);
  const containerElement = document.getElementById("main-container");

  if (containerElement) {
    ReactDOM.render(
      <ErrorBoundary>
        {/* @ts-ignore */}
        <Provider store={Store}>
          <QueryClientProvider client={reactQueryClient}>
            {/* The DnDProvider is necessary for the TreeHierarchyView. Otherwise, the view may crash in
        certain conditions. See https://github.com/scalableminds/webknossos/issues/5568 for context.
        The fix is inspired by:
        https://github.com/frontend-collective/react-sortable-tree/blob/9aeaf3d38b500d58e2bcc1d9b6febce12f8cc7b4/stories/barebones-no-context.js */}
            <DndProvider backend={HTML5Backend}>
              <GlobalThemeProvider>
                <Router />
              </GlobalThemeProvider>
            </DndProvider>
          </QueryClientProvider>
        </Provider>
      </ErrorBoundary>,
      containerElement,
    );
  }
});
