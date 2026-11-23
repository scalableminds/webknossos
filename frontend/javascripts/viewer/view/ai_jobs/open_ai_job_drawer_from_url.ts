import UrlManager from "viewer/controller/url_manager";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import Store from "viewer/store";
import {
  AI_JOB_URL_PARAM,
  canRunAIJob,
  isLinkableAIJobDrawerState,
} from "viewer/view/ai_jobs/ai_job_url_param";

export function openAIJobDrawerFromUrl() {
  const params = new URLSearchParams(location.search);
  const drawerState = params.get(AI_JOB_URL_PARAM);
  if (!isLinkableAIJobDrawerState(drawerState)) {
    return;
  }
  // Reloading the page should not open the drawer again.
  params.delete(AI_JOB_URL_PARAM);
  UrlManager.changeBaseUrl(location.pathname + (params.size > 0 ? `?${params}` : ""));
  const { dataset, activeUser, activeOrganization } = Store.getState();
  if (canRunAIJob(drawerState, dataset, activeUser, activeOrganization)) {
    Store.dispatch(setAIJobDrawerStateAction(drawerState));
  }
}
