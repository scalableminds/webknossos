import UrlManager from "viewer/controller/url_manager";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import Store from "viewer/store";
import {
  AI_ALIGNMENT_URL_PARAM_VALUE,
  AI_JOB_URL_PARAM,
  canRunAIAlignment,
} from "viewer/view/ai_jobs/ai_job_url_param";

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
