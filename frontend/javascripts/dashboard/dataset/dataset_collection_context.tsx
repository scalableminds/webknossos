import { PropTypes } from "@scalableminds/prop-types";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import {
  clearCache,
  type DatasetSortBy,
  type DatasetUpdater,
  getDatastores,
  triggerDatasetCheck,
} from "admin/rest_api";
import features from "features";
import Persistence from "libs/persistence";
import { usePrevious, useWkSelector } from "libs/react_hooks";
import UserLocalStorage from "libs/user_local_storage";
import { isUserAdminOrDatasetManager } from "libs/utils";
import last from "lodash-es/last";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type {
  APIDatasetCompact,
  APIDatasetCompactWithoutStatusAndLayerNames,
  APIMaybeUnimportedDataset,
  FolderItem,
} from "types/api_types";
import {
  type DatasetListParams,
  DEFAULT_DATASET_SORT_BY,
  MINIMUM_SEARCH_QUERY_LENGTH,
  SEARCH_RESULTS_LIMIT,
  useCreateFolderMutation,
  useDatasetSearchQuery,
  useDatasetsInFolderQuery,
  useDeleteFolderMutation,
  useFolderHierarchyQuery,
  useFolderQuery,
  useMoveFolderMutation,
  useUpdateDatasetMutation,
  useUpdateFolderMutation,
} from "./queries";

// Describes which folder modal is currently open (if any). A single one is open at a time,
// either to create a new folder below a parent or to edit an existing folder. This lives in the
// context (rather than being prop-drilled) because the triggers are spread across the dataset
// view, the folder tree and the details sidebar. The modal itself is rendered by
// DatasetFolderView, so the context never imports the modal component (which would be cyclic).
export type FolderModalState =
  | { mode: "edit"; folderId: string }
  | { mode: "create"; parentFolderId: string };

export type DatasetFilteringMode = "showAllDatasets" | "onlyShowReported" | "onlyShowUnreported";
type DatasetSortOption = Exclude<DatasetSortBy, "searchRelevance">;

export type DatasetCollectionContextValue = {
  datasets: Array<APIDatasetCompact>;
  isLoading: boolean;
  isChecking: boolean;
  checkDatasets: (organizationId: string | undefined) => Promise<void>;
  fetchDatasets: () => void;
  clearCacheAndReloadDataset: (datasetId: string) => Promise<void>;
  updateCachedDataset: (
    datasetId: string,
    updater: DatasetUpdater,
  ) => Promise<APIMaybeUnimportedDataset>;
  activeFolderId: string | null;
  setActiveFolderId: (id: string | null) => void;
  mostRecentlyUsedActiveFolderId: string | null;
  selectedDatasets: APIDatasetCompact[];
  selectedFolder: FolderItem | null;
  setSelectedFolder: (arg0: FolderItem | null) => void;
  setSelectedDatasets: React.Dispatch<React.SetStateAction<APIDatasetCompact[]>>;
  globalSearchQuery: string | null;
  setGlobalSearchQuery: (val: string | null) => void;
  searchRecursively: boolean;
  setSearchRecursively: (val: boolean) => void;
  searchTags: string[];
  setSearchTags: (tags: string[]) => void;
  datasetFilteringMode: DatasetFilteringMode;
  setDatasetFilteringMode: (mode: DatasetFilteringMode) => void;
  // The backend filters and sorting that are applied to the listed datasets.
  datasetListParams: DatasetListParams;
  sortBy: DatasetSortBy;
  setSortBy: (sortBy: DatasetSortBy) => void;
  canSortBySearchRelevance: boolean;
  // True if the search results were capped, so that more matches may exist than are shown.
  areSearchResultsLimited: boolean;
  loadAllSearchResults: () => void;
  getBreadcrumbs: (dataset: APIDatasetCompactWithoutStatusAndLayerNames) => string[] | null;
  getActiveSubfolders: () => FolderItem[];
  folderModalState: FolderModalState | null;
  setFolderModalState: (state: FolderModalState | null) => void;
  queries: {
    folderHierarchyQuery: ReturnType<typeof useFolderHierarchyQuery>;
    datasetsInFolderQuery: ReturnType<typeof useDatasetsInFolderQuery>;
    datasetSearchQuery: ReturnType<typeof useDatasetSearchQuery>;
    createFolderMutation: ReturnType<typeof useCreateFolderMutation>;
    updateFolderMutation: ReturnType<typeof useUpdateFolderMutation>;
    moveFolderMutation: ReturnType<typeof useMoveFolderMutation>;
    deleteFolderMutation: ReturnType<typeof useDeleteFolderMutation>;
    updateDatasetMutation: ReturnType<typeof useUpdateDatasetMutation>;
  };
  usedStorageInOrga: number | undefined;
};

const DatasetCollectionContext = createContext<DatasetCollectionContextValue | undefined>(
  undefined,
);

export const useDatasetCollectionContext = () => {
  const context = useContext(DatasetCollectionContext);
  if (!context)
    throw new Error(
      "No DatasetCollectionContext.Provider found when calling useDatasetCollectionContext.",
    );
  return context;
};

const ACTIVE_FOLDER_ID_STORAGE_KEY = "activeFolderId";
export const LOCAL_STORAGE_FILTER_TAGS_KEY = "lastDatasetSearchTags";

type PersistenceState = {
  searchQuery: string;
  datasetFilteringMode: DatasetFilteringMode;
};
const persistence = new Persistence<PersistenceState>(
  {
    searchQuery: PropTypes.string,
    datasetFilteringMode: PropTypes.oneOf([
      "showAllDatasets",
      "onlyShowReported",
      "onlyShowUnreported",
    ]),
  },
  "datasetList",
);

type InitialState = {
  activeFolderId: string | null;
  globalSearchQuery: string | null;
  searchRecursively: boolean;
  searchTags: string[];
  datasetFilteringMode: DatasetFilteringMode;
};

// Restores the state from the URL, the history state and the local storage, before the first
// dataset request is sent. Otherwise, each restored filter would trigger another request.
function getInitialState(): InitialState {
  const persistedState = persistence.load();
  const params = new URLSearchParams(location.search);

  let activeFolderId = UserLocalStorage.getItem(ACTIVE_FOLDER_ID_STORAGE_KEY) || null;
  activeFolderId = params.get("folderId") || activeFolderId;
  const folderSpecifier = last(location.pathname.split("/"));
  if (folderSpecifier?.includes("-")) {
    activeFolderId = last(folderSpecifier.split("-")) || activeFolderId;
  }

  let searchTags: string[] = [];
  try {
    const parsedTags = JSON.parse(UserLocalStorage.getItem(LOCAL_STORAGE_FILTER_TAGS_KEY) || "[]");
    if (Array.isArray(parsedTags)) {
      searchTags = parsedTags.filter((tag) => typeof tag === "string");
    }
  } catch (_error) {
    // Ignore invalid persisted tags.
  }

  const recursive = params.get("recursive");
  return {
    activeFolderId,
    globalSearchQuery: params.get("query") || persistedState.searchQuery || null,
    searchRecursively: recursive != null ? recursive === "true" : true,
    searchTags,
    datasetFilteringMode: persistedState.datasetFilteringMode ?? "onlyShowReported",
  };
}

export default function DatasetCollectionContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [initialState] = useState(getInitialState);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(initialState.activeFolderId);
  const [mostRecentlyUsedActiveFolderId, clearMostRecentlyUsedActiveFolderId] = usePrevious(
    activeFolderId,
    true,
  );
  const [isChecking, setIsChecking] = useState(false);
  const isMutating = useIsMutating() > 0;
  const { data: folder, isError: didFolderLoadingError } = useFolderQuery(activeFolderId);
  const usedStorageInOrga = useWkSelector((state) => state.activeOrganization?.usedStorageBytes);

  const [selectedDatasets, setSelectedDatasets] = useState<APIDatasetCompact[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<FolderItem | null>(null);
  const [folderModalState, setFolderModalState] = useState<FolderModalState | null>(null);
  const [globalSearchQuery, setGlobalSearchQueryInner] = useState<string | null>(
    initialState.globalSearchQuery,
  );
  const setGlobalSearchQuery = useCallback((value: string | null) => {
    // Empty string should be handled as null
    setGlobalSearchQueryInner(value ? value : null);
  }, []);
  const [searchRecursively, setSearchRecursively] = useState<boolean>(
    initialState.searchRecursively,
  );
  const [searchTags, setSearchTags] = useState<string[]>(initialState.searchTags);
  const [datasetFilteringMode, setDatasetFilteringMode] = useState<DatasetFilteringMode>(
    initialState.datasetFilteringMode,
  );
  // Sort order used when not sorting by search relevance.
  const [sortOption, setSortOption] = useState<DatasetSortOption>(DEFAULT_DATASET_SORT_BY);
  const [hasUserSetSort, setHasUserSetSort] = useState(false);
  const setSortBy = useCallback((sortBy: DatasetSortBy) => {
    if (sortBy === "searchRelevance") {
      setHasUserSetSort(false);
    } else {
      setSortOption(sortBy);
      setHasUserSetSort(true);
    }
  }, []);
  const queryClient = useQueryClient();
  const activeUser = useWkSelector((state) => state.activeUser);
  const isAdminOrDatasetManager = activeUser != null && isUserAdminOrDatasetManager(activeUser);

  // Fall back to relevance-sorting exactly when the search box is initially filled,
  // unless the user explicitly picks a sort option afterwards. This is adjusted during
  // rendering (instead of in an effect) so that no request with the previous sorting is sent.
  const isSearchActive = globalSearchQuery != null;
  const [wasSearchActive, setWasSearchActive] = useState(isSearchActive);
  if (isSearchActive !== wasSearchActive) {
    setWasSearchActive(isSearchActive);
    if (isSearchActive) {
      setHasUserSetSort(false);
    }
  }
  const canSortBySearchRelevance =
    globalSearchQuery != null && globalSearchQuery.length >= MINIMUM_SEARCH_QUERY_LENGTH;
  const sortBy: DatasetSortBy =
    canSortBySearchRelevance && !hasUserSetSort ? "searchRelevance" : sortOption;

  const listParams: DatasetListParams = useMemo(
    () => ({
      tags: searchTags,
      isUnreported:
        datasetFilteringMode === "onlyShowReported"
          ? false
          : datasetFilteringMode === "onlyShowUnreported"
            ? true
            : undefined,
      // Only admins and dataset managers see datasets without usable layers.
      isActive: isAdminOrDatasetManager ? undefined : true,
      onlyMyOrganization: features().isWkorgInstance || undefined,
      sortBy,
    }),
    [searchTags, datasetFilteringMode, isAdminOrDatasetManager, sortBy],
  );

  // Keep url GET parameters in sync with search and active folder
  useManagedUrlParams(globalSearchQuery, activeFolderId, searchRecursively);

  useEffect(() => {
    persistence.persist({
      searchQuery: globalSearchQuery || "",
      datasetFilteringMode,
    });
  }, [globalSearchQuery, datasetFilteringMode]);

  useEffect(() => {
    // Persist last active folder to localStorage. We
    // check folder against null to avoid that invalid ids are persisted.
    if (activeFolderId != null && folder != null && !didFolderLoadingError) {
      UserLocalStorage.setItem(ACTIVE_FOLDER_ID_STORAGE_KEY, activeFolderId);
    } else {
      UserLocalStorage.removeItem(ACTIVE_FOLDER_ID_STORAGE_KEY);
    }

    if (didFolderLoadingError) {
      setActiveFolderId(null);
      clearMostRecentlyUsedActiveFolderId();
      if (!folderHierarchyQuery.isFetching) {
        queryClient.invalidateQueries({ queryKey: ["folders"] });
      }
    }
  }, [
    folder,
    activeFolderId,
    didFolderLoadingError,
    clearMostRecentlyUsedActiveFolderId,
    queryClient,
  ]);

  const folderHierarchyQuery = useFolderHierarchyQuery();

  // A selected subfolder only makes sense within the active folder.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only clear when the active folder changes.
  useEffect(() => {
    setSelectedFolder(null);
  }, [activeFolderId]);

  // Clear the selected subfolder once it's gone (e.g., after deleting it).
  useEffect(() => {
    const itemById = folderHierarchyQuery.data?.itemById;
    if (selectedFolder != null && itemById != null && itemById[selectedFolder.key] == null) {
      setSelectedFolder(null);
    }
  }, [folderHierarchyQuery.data, selectedFolder]);
  const datasetsInFolderQuery = useDatasetsInFolderQuery(
    globalSearchQuery == null ? activeFolderId : null,
    listParams,
  );
  // Search results are capped unless the user asks to load all of them. That request only
  // holds for the search and filters it was made for, so that changing them caps the results again.
  const searchScopeKey = JSON.stringify([
    globalSearchQuery,
    activeFolderId,
    searchRecursively,
    searchTags,
    datasetFilteringMode,
  ]);
  const [loadAllSearchScopeKey, setLoadAllSearchScopeKey] = useState<string | null>(null);
  const shouldLoadAllSearchResults = loadAllSearchScopeKey === searchScopeKey;
  const loadAllSearchResults = useCallback(
    () => setLoadAllSearchScopeKey(searchScopeKey),
    [searchScopeKey],
  );
  const datasetSearchQuery = useDatasetSearchQuery(
    globalSearchQuery,
    activeFolderId,
    searchRecursively,
    listParams,
    shouldLoadAllSearchResults,
  );
  const createFolderMutation = useCreateFolderMutation();
  const deleteFolderMutation = useDeleteFolderMutation();
  const updateFolderMutation = useUpdateFolderMutation();
  const moveFolderMutation = useMoveFolderMutation();
  const updateDatasetMutation = useUpdateDatasetMutation(
    globalSearchQuery == null ? activeFolderId : null,
  );
  const datasets = (globalSearchQuery ? datasetSearchQuery.data : datasetsInFolderQuery.data) || [];

  // While all results are being loaded, the capped results are still shown as placeholder.
  const areSearchResultsLimited =
    globalSearchQuery != null &&
    datasets.length >= SEARCH_RESULTS_LIMIT &&
    (!shouldLoadAllSearchResults || datasetSearchQuery.isPlaceholderData);

  function fetchDatasets(): void {
    datasetsInFolderQuery.refetch();
    datasetSearchQuery.refetch();
  }

  async function clearCacheAndReloadDataset(datasetId: string) {
    const dataset = await updateDatasetMutation.mutateAsync(datasetId);
    await clearCache(dataset);
  }

  async function updateCachedDataset(datasetId: string, updater: DatasetUpdater) {
    return await updateDatasetMutation.mutateAsync([datasetId, updater]);
  }

  const getBreadcrumbs = (dataset: APIDatasetCompactWithoutStatusAndLayerNames) => {
    if (folderHierarchyQuery.data?.itemById == null) {
      return null;
    }
    const { itemById } = folderHierarchyQuery.data;

    let currentFolder = itemById[dataset.folderId];
    if (currentFolder == null) {
      console.warn("Breadcrumbs could not be computed.");
      return [];
    }
    const breadcrumbs = [currentFolder.title];
    while (currentFolder?.parent != null) {
      currentFolder = itemById[currentFolder.parent];
      if (currentFolder == null) {
        console.warn("Breadcrumbs could not be computed.");
        return [];
      }
      breadcrumbs.unshift(currentFolder.title);
    }

    return breadcrumbs;
  };

  const getActiveSubfolders = () => {
    return folderHierarchyQuery.data?.itemById[activeFolderId ?? ""]?.children || [];
  };

  const isLoading =
    (globalSearchQuery
      ? datasetSearchQuery.isFetching
      : folderHierarchyQuery.isPending ||
        datasetsInFolderQuery.isFetching ||
        datasetsInFolderQuery.isPlaceholderData ||
        datasetsInFolderQuery.isRefetching) || isMutating;

  const value: DatasetCollectionContextValue = {
    datasets,
    isLoading,
    fetchDatasets,
    clearCacheAndReloadDataset,
    updateCachedDataset,
    activeFolderId,
    setActiveFolderId,
    selectedFolder,
    setSelectedFolder,
    mostRecentlyUsedActiveFolderId,
    isChecking,
    getBreadcrumbs,
    getActiveSubfolders,
    folderModalState,
    setFolderModalState,
    checkDatasets: async (organizationId: string | undefined) => {
      if (isChecking) {
        console.warn("Ignore second rechecking request, since a recheck is already in progress");
        return;
      }
      setIsChecking(true);
      const datastores = await getDatastores();
      await Promise.all(
        datastores.map(
          (
            datastore, // Catch potentially failing triggers, since these should not
          ) =>
            // block the subsequent fetch of datasets. Otherwise, one offline
            // datastore will stop the refresh for all datastores.
            triggerDatasetCheck(datastore.url, organizationId).catch(() => {}),
        ),
      );
      setIsChecking(false);

      datasetsInFolderQuery.refetch();
      datasetSearchQuery.refetch();
    },
    selectedDatasets,
    setSelectedDatasets,
    globalSearchQuery,
    setGlobalSearchQuery,
    searchRecursively,
    setSearchRecursively,
    searchTags,
    setSearchTags,
    datasetFilteringMode,
    setDatasetFilteringMode,
    datasetListParams: listParams,
    sortBy,
    setSortBy,
    canSortBySearchRelevance,
    areSearchResultsLimited,
    loadAllSearchResults,
    queries: {
      folderHierarchyQuery,
      datasetsInFolderQuery,
      datasetSearchQuery,
      createFolderMutation,
      deleteFolderMutation,
      updateFolderMutation,
      moveFolderMutation,
      updateDatasetMutation,
    },
    usedStorageInOrga,
  };

  return (
    <DatasetCollectionContext.Provider value={value}>{children}</DatasetCollectionContext.Provider>
  );
}

// The URL params are read once when the provider is created (see getInitialState).
function useManagedUrlParams(
  globalSearchQuery: string | null,
  activeFolderId: string | null,
  searchRecursively: boolean,
) {
  const { data: folder } = useFolderQuery(activeFolderId);

  // Update folderId
  useEffect(() => {
    if (!globalSearchQuery && activeFolderId) {
      let folderName = folder?.name || "";
      // The replacement of / and space is only done to make the URL
      // nicer to read for a human.
      // encodeURIComponent is used so that special characters, such as # and ?
      // don't break the URL parsing.
      folderName = encodeURIComponent(folderName.replace(/[/ ]+/g, "-"));

      // Use folderName-folderId in path or only folderId if name is empty (e.g., because
      // not loaded yet).
      // Don't use useNavigate because this would lose the input search
      // focus. Keep the existing history state, since react-router stores its own data there.
      window.history.replaceState(
        window.history.state,
        "",
        `/dashboard/datasets/${folderName}${folderName ? "-" : ""}${activeFolderId}`,
      );
    } else {
      const params = new URLSearchParams(location.search);
      if (globalSearchQuery) {
        params.set("query", globalSearchQuery);
      } else {
        params.delete("query");
      }
      if (globalSearchQuery && activeFolderId) {
        params.set("folderId", activeFolderId);
        // The recursive property is only relevant when a folderId is specified.
        if (searchRecursively) {
          params.set("recursive", "true");
        } else {
          params.set("recursive", "false");
        }
      } else {
        params.delete("folderId");
        params.delete("recursive");
      }
      const paramStr = params.toString();

      // Don't use useNavigate because this would lose the input search
      // focus. Keep the existing history state, since react-router stores its own data there.
      window.history.replaceState(
        window.history.state,
        "",
        `/dashboard/datasets${paramStr === "" ? "" : "?"}${paramStr}`,
      );
    }
  }, [globalSearchQuery, activeFolderId, folder, searchRecursively]);
}
