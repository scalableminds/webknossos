import { getVoxelyticsWorkflow } from "admin/admin_rest_api";
import { VoxelyticsRunState } from "types/api_flow_types";

const subscribedWorkflows: string[] = [];
const previousStateByWorkflowId: { [key: string]: boolean } = {};
let runningInterval: ReturnType<typeof setInterval> | null = null;

export function subscribeToWorkflow(workflowHash: string) {
  console.log("subscribing", workflowHash, subscribedWorkflows);
  const wasNotPolling = subscribedWorkflows.length === 0;
  if (!subscribedWorkflows.includes(workflowHash)) {
    subscribedWorkflows.push(workflowHash);
  }
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(subscribedWorkflows));
  if (!runningInterval || wasNotPolling) {
    guardForNotificationsPermission(() => {
      if (runningInterval) {
        clearInterval(runningInterval);
      }
      runningInterval = setInterval(pollWorkflowUpdates, POLL_INTERVAL);
    });
  }
}

const pollWorkflowUpdates = async () => {
  const workflowsToRemove: string[] = [];
  await Promise.all(
    subscribedWorkflows.map(async (workflowHash: string) => {
      const report = await getVoxelyticsWorkflow(workflowHash, null);
      const isTaskStillPending = report.runs.some(
        (run) => run.state === VoxelyticsRunState.RUNNING,
      );
      console.log("isTaskStillPending", isTaskStillPending);
      if (
        !isTaskStillPending &&
        // Only notify if it's done and previously it wasn't done (or unknown)
        (previousStateByWorkflowId[workflowHash] == null || previousStateByWorkflowId[workflowHash])
      ) {
        console.log("sending notification");
        new Notification("Voxelytics workflow finished", {
          body: `Voxelytics workflow ${report.workflow.name} has finished!`,
        });
      }
      previousStateByWorkflowId[workflowHash] = isTaskStillPending;
      // workflowsToRemove.push(workflowHash);
    }),
  );
  workflowsToRemove.forEach((workflowHash) => {
    const index = subscribedWorkflows.indexOf(workflowHash);
    if (index > -1) {
      subscribedWorkflows.splice(index, 1);
    }
  });
  if (subscribedWorkflows.length === 0 && runningInterval) {
    clearInterval(runningInterval);
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } else {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(subscribedWorkflows));
  }
};

const POLL_INTERVAL = 2 * 1000;

function guardForNotificationsPermission(callback: () => void) {
  if (!("Notification" in window)) {
    return;
  }
  if (Notification.permission !== "granted") {
    Notification.requestPermission((result) => {
      if (result === "granted") {
        callback();
      }
    });
  } else {
    callback();
  }
}

const LOCAL_STORAGE_KEY = "voxelytics_notification_subscriptions";
function loadStoredVXNotificationSubscriptions() {
  const storedSubscriptions = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (storedSubscriptions) {
    const parsedSubscriptions = JSON.parse(storedSubscriptions);
    if (Array.isArray(parsedSubscriptions)) {
      parsedSubscriptions.forEach((workflowHash: string) => {
        subscribeToWorkflow(workflowHash);
      });
    }
  }
}
loadStoredVXNotificationSubscriptions();
