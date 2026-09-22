import { useQuery } from "@tanstack/react-query";
import { getAnnotationCountForDataset } from "admin/rest_api";
import { Link } from "react-router";
import type { APIDataset } from "types/api_types";
import { InfoTabRow } from "./info_tab_layout";

// Annotations do get added while a dataset is open, so unlike the organization lookup this
// is only held for a few minutes rather than for the whole session.
const ANNOTATION_COUNT_STALE_TIME = 5 * 60 * 1000;

export function DatasetAnnotationCountLink({
  dataset,
  label,
}: {
  dataset: APIDataset;
  /** "Annotations" in view mode, "Other annotations" next to the current one. */
  label: string;
}) {
  const { data: annotationCount } = useQuery({
    queryKey: ["annotationCount", dataset.id],
    queryFn: () => getAnnotationCountForDataset(dataset.id),
    staleTime: ANNOTATION_COUNT_STALE_TIME,
    refetchOnWindowFocus: false,
  });

  if (!annotationCount) return null;

  return (
    <InfoTabRow label={label} isShortValue tooltip="Go to the annotation list for this dataset">
      <Link to={`/dashboard/annotations?dataset=${encodeURIComponent(dataset.name)}`}>
        {annotationCount} ›
      </Link>
    </InfoTabRow>
  );
}
