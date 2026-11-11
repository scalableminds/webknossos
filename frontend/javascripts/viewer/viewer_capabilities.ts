import once from "lodash-es/once";
import {
  isLayerRegistrationPrimaryWorker,
  isLayerRegistrationWorker,
} from "viewer/view/layer_registration/layer_registration_protocol";

// What the viewer offers where it runs. Everything is on in the normal viewer. Embedded viewers,
// such as the workers of the layer registration page, turn parts of it off.
export type ViewerCapabilities = {
  // Whether changed user settings, dataset settings and layouts are stored.
  shouldPersistSettings: boolean;
  // The share button and "Copy to my account" of sandboxes.
  showShareAndCopyActions: boolean;
  showToolkitSwitch: boolean;
  showRightBorder: boolean;
  showCommandPalette: boolean;
  // The menus, the help button and the user avatar of the navbar.
  showNavbarMenus: boolean;
  // The WEBKNOSSOS logo, which links to the dashboard.
  showDashboardLink: boolean;
};

const DEFAULT_CAPABILITIES: ViewerCapabilities = {
  shouldPersistSettings: true,
  showShareAndCopyActions: true,
  showToolkitSwitch: true,
  showRightBorder: true,
  showCommandPalette: true,
  showNavbarMenus: true,
  showDashboardLink: true,
};

// The workers are sandboxes inside the layer registration page (see
// layer_registration_worker.ts). They offer nothing that leaves the page, opens a worker without
// the page around it, or changes what the page set up.
const LAYER_REGISTRATION_PRIMARY_WORKER_CAPABILITIES: ViewerCapabilities = {
  // The workers force some settings, which must not end up in the user's account or in the
  // layouts of the normal viewer.
  shouldPersistSettings: false,
  // A shared link would open the worker without the page. The page saves the landmarks, so
  // copying the worker's sandbox makes no sense.
  showShareAndCopyActions: false,
  // The workers only offer the tools for placing landmarks.
  showToolkitSwitch: false,
  // The tabs of the right border (e.g. the dataset info with its links) break the page.
  showRightBorder: false,
  // The command palette can leave the page or undo the forced settings.
  showCommandPalette: false,
  // The workers keep the navbar because it contains the toolbar, but its menus lead away from
  // the page.
  showNavbarMenus: false,
  // The layer registration page has no navbar, so the left worker links to the dashboard.
  showDashboardLink: true,
};

const LAYER_REGISTRATION_SECONDARY_WORKER_CAPABILITIES: ViewerCapabilities = {
  ...LAYER_REGISTRATION_PRIMARY_WORKER_CAPABILITIES,
  showDashboardLink: false,
};

// Computed once, because the URL params don't change while the viewer runs: navigation within a
// worker is blocked (see blockLayerRegistrationWorkerNavigation).
export const getViewerCapabilities = once((): ViewerCapabilities => {
  if (!isLayerRegistrationWorker()) {
    return DEFAULT_CAPABILITIES;
  }
  return isLayerRegistrationPrimaryWorker()
    ? LAYER_REGISTRATION_PRIMARY_WORKER_CAPABILITIES
    : LAYER_REGISTRATION_SECONDARY_WORKER_CAPABILITIES;
});
