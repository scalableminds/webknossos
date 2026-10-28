import { useQuery } from "@tanstack/react-query";
import { getJob } from "admin/rest_api";
import type { APIJob } from "types/api_types";

const POLLING_INTERVAL = 5000; // ms

function isJobFinished(job: APIJob | undefined): boolean {
  return job != null && ["SUCCESS", "FAILURE", "CANCELLED"].includes(job.state);
}

/**
 * Polls the conversion job of a freshly uploaded dataset until it has finished.
 * Pass null as jobId to not poll at all.
 */
export function useConversionJob(jobId: string | null): APIJob | null {
  const { data: job } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId as string),
    enabled: jobId != null,
    refetchInterval: (query) => (isJobFinished(query.state.data) ? false : POLLING_INTERVAL),
  });

  return job ?? null;
}
