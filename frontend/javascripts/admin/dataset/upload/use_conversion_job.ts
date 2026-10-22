import { useQuery } from "@tanstack/react-query";
import { getJob, getJobs } from "admin/rest_api";
import { type APIJob, APIJobCommand } from "types/api_types";

const POLLING_INTERVAL = 5000; // ms

function isJobFinished(job: APIJob | undefined): boolean {
  return job != null && ["SUCCESS", "FAILURE", "CANCELLED"].includes(job.state);
}

/**
 * Polls the conversion job of a freshly uploaded dataset until it has finished.
 * Pass null as datasetId to not poll at all.
 */
export function useConversionJob(datasetId: string | null): APIJob | null {
  // The job id is unknown, so the job has to be looked up by its dataset first.
  const { data: jobId } = useQuery({
    queryKey: ["conversionJobId", datasetId],
    queryFn: async () => {
      const jobs = await getJobs(APIJobCommand.CONVERT_TO_WKW);
      return jobs.find((job) => job.args.datasetId === datasetId)?.id ?? null;
    },
    enabled: datasetId != null,
    refetchInterval: (query) => (query.state.data == null ? POLLING_INTERVAL : false),
  });

  const { data: job } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId as string),
    enabled: jobId != null,
    refetchInterval: (query) => (isJobFinished(query.state.data) ? false : POLLING_INTERVAL),
  });

  return job ?? null;
}
