import { exploreRemoteDataset } from "admin/rest_api";
import { useCallback, useState } from "react";
import type { VoxelSize } from "types/api_types";
import type { DatasourceConfiguration } from "types/schemas/datasource.types";
import { buildExploreCredentials, type RemoteCredentialsInput } from "./remote_credentials";
import { classifyExploreReport, detectStorage, type ExploreError } from "./remote_url_utils";

export type ExploreRequest = {
  url: string;
  datastoreName: string;
  // Only sent if the credentials panel is open.
  credentials: RemoteCredentialsInput | null;
  preferredVoxelSize?: VoxelSize;
};

const ensureLargestSegmentIdsInPlace = (datasource: DatasourceConfiguration): void => {
  for (const layer of datasource.dataLayers) {
    if (layer.category === "color" || layer.largestSegmentId != null) {
      continue;
    }
    // Make sure the property exists, so that it is part of the stored datasource.
    layer.largestSegmentId = null;
  }
};

// Request rejects with either an Error or the parsed error body of the backend.
function getRequestErrorMessage(exception: unknown): string {
  if (exception instanceof Error) return exception.message;
  const body = exception as { messages?: Array<Record<string, string>>; errors?: string[] };
  const messages = body?.messages?.flatMap((message) => Object.values(message)) ?? body?.errors;
  return messages != null && messages.length > 0 ? messages.join(" ") : String(exception);
}

/**
 * Explores one remote URL with the backend. Each URL field owns one instance, so that its
 * loading and error state stay separate from the other fields.
 */
export function useRemoteExplore() {
  const [isExploring, setIsExploring] = useState(false);
  const [error, setError] = useState<ExploreError | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // Resolves to null if the URL couldn't be explored. The reason is available as `error`.
  const explore = useCallback(
    async ({
      url,
      datastoreName,
      credentials,
      preferredVoxelSize,
    }: ExploreRequest): Promise<DatasourceConfiguration | null> => {
      const trimmedUrl = url.trim();
      const storage = detectStorage(trimmedUrl);
      if (storage == null) {
        setError({ kind: "protocol", report: null, withCredentials: false });
        return null;
      }

      setIsExploring(true);
      setError(null);
      let exploreCredentials = null;
      try {
        exploreCredentials =
          credentials != null ? await buildExploreCredentials(storage, credentials) : null;
        const { dataSource, report } = await exploreRemoteDataset(
          [encodeURI(trimmedUrl)],
          datastoreName,
          exploreCredentials,
          preferredVoxelSize?.factor,
        );
        if (dataSource == null || dataSource.dataLayers.length === 0) {
          setError({
            kind: classifyExploreReport(report),
            report,
            withCredentials: exploreCredentials != null,
          });
          return null;
        }
        ensureLargestSegmentIdsInPlace(dataSource);
        return dataSource;
      } catch (exception) {
        setError({
          kind: "request",
          report: null,
          withCredentials: exploreCredentials != null,
          message: getRequestErrorMessage(exception),
        });
        return null;
      } finally {
        setIsExploring(false);
      }
    },
    [],
  );

  return { explore, isExploring, error, clearError };
}
