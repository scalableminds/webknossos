import features from "features";
import { getJob, getJobs } from "admin/admin_rest_api";
import { useEffect, useState } from "react";
import { APIJob } from "types/api_flow_types";
import { usePolling } from "libs/react_hooks";

export function useStartAndPollJob({
  onSuccess = () => {},
  onFailure = () => {},
  onManual = () => {},
  initialJobKeyExtractor,
  interval = 2000,
}: {
  onSuccess?: (job: APIJob, isInitial: boolean) => void;
  onFailure?: (job: APIJob, isInitial: boolean) => void;
  onManual?: (job: APIJob, isInitial: boolean) => void;
  initialJobKeyExtractor?: (job: APIJob) => string | null;
  interval?: number;
}): [
  Array<[string, string]>,
  ((startJobFn: () => Promise<[string, string]>) => Promise<void>) | null,
] {
  const [runningJobs, setRunningJobs] = useState<Array<[string, string]>>([]);

  useEffect(() => {
    if (initialJobKeyExtractor != null) {
      (async () => {
        const jobs = await getJobs();
        for (const job of jobs) {
          const key = initialJobKeyExtractor(job);
          if (key != null) {
            if (job.state === "SUCCESS") {
              onSuccess(job, true);
            } else if (job.state === "FAILURE") {
              onFailure(job, true);
            } else if (job.state === "MANUAL") {
              onManual(job, true);
            } else {
              setRunningJobs((previous) => [...previous, [key, job.id]]);
            }
          }
        }
      })();
    }
  }, []);

  const areJobsEnabled = features().jobsEnabled;

  async function checkForJobs() {
    for (const [, jobId] of runningJobs) {
      const job = await getJob(jobId);
      if (job.state === "SUCCESS") {
        onSuccess(job, false);
        setRunningJobs((previous) => previous.filter(([, j]) => j !== jobId));
      } else if (job.state === "FAILURE") {
        onFailure(job, false);
        setRunningJobs((previous) => previous.filter(([, j]) => j !== jobId));
      } else if (job.state === "MANUAL") {
        onManual(job, false);
        setRunningJobs((previous) => previous.filter(([, j]) => j !== jobId));
      }
    }
  }

  usePolling(checkForJobs, runningJobs.length > 0 ? interval : null, [
    runningJobs.map(([key]) => key).join("-"),
  ]);

  return [
    runningJobs,
    areJobsEnabled
      ? async (startJobFn) => {
          const [key, jobId] = await startJobFn();
          setRunningJobs((previous) => [...previous, [key, jobId]]);
        }
      : null,
  ];
}
