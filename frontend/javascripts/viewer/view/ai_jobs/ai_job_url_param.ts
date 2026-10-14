import { isUserAdminOrManager } from "libs/utils";
import { type APIDataset, APIJobCommand, type APIUser } from "types/api_types";
import UrlManager from "viewer/controller/url_manager";
import {
  getColorLayers,
  getViewDatasetURL,
  is2dDataset,
} from "viewer/model/accessors/dataset_accessor";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import Store from "viewer/store";

// The URL param of the dataset view that opens the drawer of the AI alignment job once the
// dataset is loaded, e.g. when the dataset is opened from the modal shown after an upload.
const AI_JOB_URL_PARAM = "aiJob";
const AI_ALIGNMENT_URL_PARAM_VALUE = "alignment";

export function getViewDatasetUrlWithAIAlignment(dataset: { name: string; id: string }): string {
  return `${getViewDatasetURL(dataset)}?${AI_JOB_URL_PARAM}=${AI_ALIGNMENT_URL_PARAM_VALUE}`;
}

// The same conditions as for the "Run AI Alignment" item of the "AI Analysis" menu, see
// action_bar_view.tsx.
export function canRunAIAlignment(dataset: APIDataset, activeUser: APIUser | null | undefined) {
  const colorLayers = getColorLayers(dataset);
  const isNd = (colorLayers[0]?.additionalAxes ?? []).length > 0;
  return (
    activeUser != null &&
    isUserAdminOrManager(activeUser) &&
    dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobCommand.ALIGN_SECTIONS) &&
    colorLayers.length > 0 &&
    !is2dDataset(dataset) &&
    !isNd
  );
}

export function openAIJobDrawerFromUrl() {
  const params = new URLSearchParams(location.search);
  if (params.get(AI_JOB_URL_PARAM) !== AI_ALIGNMENT_URL_PARAM_VALUE) {
    return;
  }
  // Reloading the page should not open the drawer again.
  params.delete(AI_JOB_URL_PARAM);
  UrlManager.changeBaseUrl(location.pathname + (params.size > 0 ? `?${params}` : ""));
  const { dataset, activeUser } = Store.getState();
  if (canRunAIAlignment(dataset, activeUser)) {
    Store.dispatch(setAIJobDrawerStateAction("open_ai_alignment"));
  }
}
