import { isJobAvailable } from "admin/organization/pricing_plan_utils";
import { isUserAdminOrManager } from "libs/utils";
import {
  type APIDataset,
  APIJobCommand,
  type APIOrganization,
  type APIUser,
} from "types/api_types";
import {
  getColorLayers,
  getViewDatasetURL,
  is2dDataset,
} from "viewer/model/accessors/dataset_accessor";
import type { StartAiJobDrawerState } from "viewer/view/ai_jobs/constants";

// Pages outside the viewer (e.g. the modal shown after an upload) import this module, so it must
// not import the viewer itself (e.g. the url manager or the store). See viewer/viewer_entry.ts.

// The URL param of the dataset view that opens the AI job drawer in the given state once the
// dataset is loaded, e.g. when the dataset is opened from the modal shown after an upload.
export const AI_JOB_URL_PARAM = "aiJob";

// The jobs that can be started from each drawer state that can be linked to. A drawer state is
// only opened if one of its jobs is available.
const JOB_COMMANDS_BY_LINKABLE_DRAWER_STATE = {
  open_ai_alignment: [APIJobCommand.ALIGN_SECTIONS],
  open_ai_inference: [
    APIJobCommand.INFER_NEURONS,
    APIJobCommand.INFER_MITOCHONDRIA,
    APIJobCommand.INFER_INSTANCES,
  ],
} satisfies Partial<Record<StartAiJobDrawerState, APIJobCommand[]>>;

export type LinkableAIJobDrawerState = keyof typeof JOB_COMMANDS_BY_LINKABLE_DRAWER_STATE;

export function isLinkableAIJobDrawerState(
  value: string | null,
): value is LinkableAIJobDrawerState {
  return value != null && Object.hasOwn(JOB_COMMANDS_BY_LINKABLE_DRAWER_STATE, value);
}

export function getViewDatasetUrlWithAIJob(
  dataset: { name: string; id: string },
  drawerState: LinkableAIJobDrawerState,
): string {
  return `${getViewDatasetURL(dataset)}?${AI_JOB_URL_PARAM}=${drawerState}`;
}

// Why no AI job can run on the dataset, or null if they can. The "AI Analysis" menu
// (action_bar_view.tsx) shows the reason as the tooltip of its disabled button.
export function getAIJobsUnsupportedReason(dataset: APIDataset): string | null {
  const colorLayers = getColorLayers(dataset);
  if (colorLayers.length === 0) {
    return "The dataset needs to have a color layer to start AI processing jobs.";
  }
  if (is2dDataset(dataset)) {
    return "AI Analysis is not supported for 2D datasets.";
  }
  if ((colorLayers[0]?.additionalAxes ?? []).length > 0) {
    return "AI Analysis is not supported for ND datasets.";
  }
  return null;
}

// Whether the user can start a job of the given drawer state from the "AI Analysis" menu
// (action_bar_view.tsx).
export function canRunAIJob(
  drawerState: LinkableAIJobDrawerState,
  dataset: APIDataset,
  activeUser: APIUser | null | undefined,
  activeOrganization: APIOrganization | null,
) {
  return (
    activeUser != null &&
    isUserAdminOrManager(activeUser) &&
    getAIJobsUnsupportedReason(dataset) == null &&
    JOB_COMMANDS_BY_LINKABLE_DRAWER_STATE[drawerState].some((jobCommand) =>
      isJobAvailable(dataset.dataStore, jobCommand, activeOrganization),
    )
  );
}
