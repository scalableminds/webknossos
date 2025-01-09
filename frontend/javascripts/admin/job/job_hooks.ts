import { getJob, getJobs } from "admin/admin_rest_api";
import features from "features";
import { useEffectOnlyOnce, usePolling } from "libs/react_hooks";
import { useState } from "react";
import type { APIJob } from "types/api_flow_types";

type JobInfo = [jobKey: string, jobId: string];

export function useStartAndPollJob({
  onSuccess = () => {},
  onFailure = () => {},
  initialJobKeyExtractor,
  interval = 2000,
}: {
  onSuccess?: (job: APIJob) => void;
  onFailure?: (job: APIJob) => void;
  initialJobKeyExtractor?: (job: APIJob) => string | null;
  interval?: number;
}): {
  runningJobs: Array<JobInfo>;
  startJob: ((startJobFn: () => Promise<JobInfo>) => Promise<void>) | null;
  mostRecentSuccessfulJob: APIJob | null;
} {
  const areJobsEnabled = features().jobsEnabled;

  const [runningJobs, setRunningJobs] = useState<Array<JobInfo>>([]);
  const [mostRecentSuccessfulJob, setMostRecentSuccessfulJob] = useState<APIJob | null>(null);

  useEffectOnlyOnce(() => {
    if (initialJobKeyExtractor != null && areJobsEnabled) {
      (async () => {
        const jobs = await getJobs();
        jobs.sort((a, b) => b.createdAt - a.createdAt); // sort in descending order
        for (const job of jobs) {
          const key = initialJobKeyExtractor(job);
          if (key != null && job.state === "SUCCESS") {
            setMostRecentSuccessfulJob(job);
            break;
          }
        }
      })();
    }
  });

  async function checkForJobs() {
    for (const [, jobId] of runningJobs) {
      const job = await getJob(jobId);
      if (job.state === "SUCCESS") {
        onSuccess(job);
        setRunningJobs((previous) => previous.filter(([, j]) => j !== jobId));
        if (mostRecentSuccessfulJob == null || job.createdAt > mostRecentSuccessfulJob.createdAt) {
          setMostRecentSuccessfulJob(job);
        }
      } else if (job.state === "FAILURE") {
        onFailure(job);
        setRunningJobs((previous) => previous.filter(([, j]) => j !== jobId));
      }
    }
  }

  usePolling(checkForJobs, runningJobs.length > 0 ? interval : null);

  return {
    runningJobs,
    startJob: areJobsEnabled
      ? async (startJobFn) => {
          const [key, jobId] = await startJobFn();
          setRunningJobs((previous) => [...previous, [key, jobId]]);
        }
      : null,
    mostRecentSuccessfulJob,
  };
}
