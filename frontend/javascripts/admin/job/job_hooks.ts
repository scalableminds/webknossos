import features from "features";
import { getJobs } from "admin/admin_rest_api";
import { useInterval } from "beautiful-react-hooks";
import Toast from "libs/toast";
import { OxalisState } from "oxalis/store";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { APIJob } from "types/api_flow_types";

export function useStartAndPollJob({
  startJobFn,
  findJobPred,
  successMessage,
  failureMessage,
  jobStartedMessage,
  interval = 2000,
}: {
  startJobFn: (() => Promise<APIJob>) | null;
  findJobPred: (job: APIJob) => boolean;
  successMessage: string;
  failureMessage: string;
  jobStartedMessage: string;
  interval?: number;
}): {
  startJob: (() => Promise<void>) | null;
  activeJob: APIJob | null;
  mostRecentSuccessfulJob: APIJob | undefined;
} {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const [jobs, setJobs] = useState<APIJob[] | null>(null);
  const [activeJob, setActiveJob] = useState<APIJob | null>(null);
  const areJobsEnabled = features().jobsEnabled;
  const potentialJobs = (jobs || []).filter(findJobPred);
  const mostRecentSuccessfulJob = potentialJobs.find((job) => job.state === "SUCCESS");

  const wrappedStartJobFn =
    startJobFn != null && activeUser != null && areJobsEnabled
      ? async () => {
          const job = await startJobFn();
          setActiveJob(job);
          Toast.info(jobStartedMessage);
        }
      : null;

  useInterval(async () => {
    if (activeUser == null || !areJobsEnabled) {
      return;
    }
    setJobs(await getJobs());
  }, interval);

  useEffect(() => {
    const newActiveJob = activeJob != null ? jobs?.find((job) => job.id === activeJob.id) : null;

    if (newActiveJob != null) {
      // We are aware of a running job. Check whether the job is finished now.
      switch (newActiveJob.state) {
        case "SUCCESS": {
          Toast.success(successMessage);
          setActiveJob(null);
          break;
        }

        case "STARTED":
        case "UNKNOWN":
        case "PENDING": {
          break;
        }

        case "FAILURE": {
          Toast.info(failureMessage);
          setActiveJob(null);
          break;
        }

        case "MANUAL": {
          Toast.info(
            "The job didn't finish properly. The job will be handled by an admin shortly. Please check back here soon.",
          );
          setActiveJob(null);

          break;
        }

        default: {
          break;
        }
      }
    } else {
      // Check whether there is an active job (e.g., the user
      // started the job earlier and reopened WEBKNOSSOS in the meantime).
      const pendingJobs = potentialJobs.filter(
        (job) => job.state === "STARTED" || job.state === "PENDING",
      );
      const newestActiveJob = pendingJobs.length > 0 ? pendingJobs[0] : null;
      setActiveJob(newestActiveJob);
    }
  }, [jobs]);

  return {
    startJob: wrappedStartJobFn,
    activeJob,
    mostRecentSuccessfulJob,
  };
}
