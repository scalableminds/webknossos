import { useQuery } from "@tanstack/react-query";
import { getAnnotationCountForDataset } from "admin/rest_api";
import FastTooltip from "components/fast_tooltip";
import { pluralize } from "libs/utils";
import { Link } from "react-router";
import type { APIDataset } from "types/api_types";

export function DatasetAnnotationCountLink({ dataset }: { dataset: APIDataset }) {
  const { data: annotationCount } = useQuery({
    queryKey: ["annotationCount", dataset.id],
    queryFn: () => getAnnotationCountForDataset(dataset.id),
    refetchOnWindowFocus: false,
  });

  if (!annotationCount) return null;

  return (
    <FastTooltip title="Go to the annotation list for this dataset" placement="left">
      <Link to={`/dashboard/annotations?dataset=${encodeURIComponent(dataset.name)}`}>
        {annotationCount} {pluralize("Annotation", annotationCount)} ›
      </Link>
    </FastTooltip>
  );
}
