import { useCallback, useState } from "react";
import type { VoxelSize } from "types/api_types";
import { EMPTY_CREDENTIALS, type RemoteCredentialsInput } from "./remote_credentials";
import { detectFormat, detectStorage } from "./remote_url_utils";
import { useRemoteExplore } from "./use_remote_explore";

export type ExploreOptions = {
  datastoreName: string;
  preferredVoxelSize?: VoxelSize;
};

/** State of one URL field: the URL, its optional credentials and its explore call. */
export function useRemoteUrlField(initialUrl = "") {
  const [url, setUrlState] = useState(initialUrl);
  const [isCredentialsOpen, setIsCredentialsOpen] = useState(false);
  const [credentials, setCredentials] = useState<RemoteCredentialsInput>(EMPTY_CREDENTIALS);
  const { explore, isExploring, error, clearError } = useRemoteExplore();

  const storage = detectStorage(url);
  const format = detectFormat(url);

  const setUrl = (newUrl: string) => {
    // Credentials of one storage don't apply to another one.
    if (detectStorage(newUrl) !== storage) setCredentials(EMPTY_CREDENTIALS);
    setUrlState(newUrl);
    clearError();
  };

  const toggleCredentials = () => {
    if (isCredentialsOpen) setCredentials(EMPTY_CREDENTIALS);
    setIsCredentialsOpen(!isCredentialsOpen);
  };

  const exploreUrl = useCallback(
    (options: ExploreOptions, urlToExplore = url) =>
      explore({
        url: urlToExplore,
        credentials: isCredentialsOpen ? credentials : null,
        ...options,
      }),
    [explore, url, isCredentialsOpen, credentials],
  );

  const reset = () => {
    setUrlState("");
    setCredentials(EMPTY_CREDENTIALS);
    setIsCredentialsOpen(false);
    clearError();
  };

  return {
    url,
    setUrl,
    storage,
    format,
    isCredentialsOpen,
    toggleCredentials,
    openCredentials: () => setIsCredentialsOpen(true),
    credentials,
    setCredentials,
    exploreUrl,
    isExploring,
    error,
    reset,
  };
}

export type RemoteUrlField = ReturnType<typeof useRemoteUrlField>;
