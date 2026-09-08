import { useQuery } from "@tanstack/react-query";
import { getSegmentStatisticsFileInfo } from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";
import type { APIDataLayer, SegmentStatisticsFileInfo } from "types/api_types";

export type SegmentStatisticsFile = {
  fileInfo: SegmentStatisticsFileInfo | null;
  isLoading: boolean;
};

/*
 * Reports the segment statistics attachment of the given layer, if it has one, together with the
 * mag and mapping it was computed for and the metrics it contains.
 *
 * The backend routes live on the datastore only, so a layer that belongs to a volume annotation
 * never has a usable file. Callers share one react-query cache entry per layer, so querying this
 * from several components does not cause additional requests.
 */
export function useSegmentStatisticsFile(
  layer: APIDataLayer | null | undefined,
): SegmentStatisticsFile {
  const dataset = useWkSelector((state) => state.dataset);
  const layerName = layer?.name;
  const isVolumeAnnotationLayer = layer != null && "tracingId" in layer && layer.tracingId != null;
  const isEnabled = layerName != null && !isVolumeAnnotationLayer;

  const { data, isLoading } = useQuery({
    queryKey: ["segmentStatisticsFile", dataset.id, layerName],
    queryFn: () => getSegmentStatisticsFileInfo(dataset.dataStore.url, dataset.id, layerName!),
    enabled: isEnabled,
    // The attachment does not change while a dataset is open, so it is fetched at most once.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    // Don't persist to localStorage, so that registering an attachment is picked up on reload
    // instead of being hidden by a cached "no file" answer.
    meta: { persist: false },
  });

  return { fileInfo: data ?? null, isLoading: isEnabled && isLoading };
}
