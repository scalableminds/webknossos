import { message } from "antd";
import window, { document } from "libs/window";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { warnIfEmailIsUnverified } from "viewer/model/sagas/user_saga";
import UnthrottledStore, { startSaga } from "viewer/store";

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { checkAnyOrganizationExists, getActiveUser, getOrganization } from "admin/rest_api";
import ErrorBoundary from "components/error_boundary";
import { RootForFastTooltips } from "components/fast_tooltip";
import { load as loadFeatureToggles } from "features";
import checkBrowserFeatures from "libs/browser_feature_check";
import ErrorHandling from "libs/error_handling";
import UserLocalStorage from "libs/user_local_storage";
import { compress, decompress } from "lz-string";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { setupApi } from "viewer/api/internal_api";
import Model from "viewer/model";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { setHasOrganizationsAction, setThemeAction } from "viewer/model/actions/ui_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import { setModel, setStore } from "viewer/singletons";
import Store from "viewer/throttled_store";

import "../stylesheets/main.less";
import { CheckCertificateModal } from "components/check_certificate_modal";
import DisableGenericDnd from "components/disable_generic_dnd";
import { CheckTermsOfServices } from "components/terms_of_services_check";
import { RouterProvider } from "react-router-dom";
import router from "router/router";
import GlobalThemeProvider, { getThemeFromUser } from "theme";
import HelpButton from "viewer/view/help_modal";

// Suppress warning emitted by Olvy because it tries to eagerly initialize
window.OlvyConfig = null;

setModel(Model);
setStore(UnthrottledStore);
setupApi();
startSaga(warnIfEmailIsUnverified);

const reactQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      cacheTime: Number.POSITIVE_INFINITY,
    },
  },
});

const localStoragePersister = createSyncStoragePersister({
  storage: UserLocalStorage,
  serialize: (data) => compress(JSON.stringify(data)),
  deserialize: (data) => JSON.parse(decompress(data) || "{}"),
  key: "query-cache-v3",
});

async function tryToLoadActiveUser() {
  // Try to retrieve the currently active user if logged in
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
  const hasOrganizations = await checkAnyOrganizationExists();
  Store.dispatch(setHasOrganizationsAction(hasOrganizations));
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
  checkBrowserFeatures();
  const containerElement = document.getElementById("main-container");

  try {
    await Promise.all([
      loadFeatureToggles(),
      // This function call cannot error as it has a try-catch built-in
      tryToLoadActiveUser(),
      // *Don't* ignore errors in this request. We only want
      // to show an onboarding screen if the back-end replied
      // with hasOrganizations==true.
      loadHasOrganizations(),
    ]);
    await loadOrganization();
  } catch (e) {
    console.error("Failed to load WEBKNOSSOS due to the following error", e);
    if (containerElement) {
      const react_root = createRoot(containerElement);
      react_root.render(
        <p style={{ margin: 20, marginTop: -20 }}>
          Failed to load WEBKNOSSOS. Please try again or check the console for details.
        </p>,
      );
    }
    return;
  }

  if (containerElement) {
    const react_root = createRoot(containerElement);
    react_root.render(
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
                <RootForFastTooltips />
                <DisableGenericDnd />
                <CheckCertificateModal />
                <CheckTermsOfServices />
                <HelpButton />
                <RouterProvider router={router} />
              </GlobalThemeProvider>
            </DndProvider>
          </QueryClientProvider>
        </Provider>
      </ErrorBoundary>,
    );
  }
});
