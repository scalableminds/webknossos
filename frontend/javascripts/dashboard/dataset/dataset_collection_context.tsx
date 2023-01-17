import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type DatasetFilteringMode } from "dashboard/dataset_view";
import type { APIMaybeUnimportedDataset, APIDatasetId, APIDataset } from "types/api_flow_types";
import { getDatastores, triggerDatasetCheck } from "admin/admin_rest_api";
import UserLocalStorage from "libs/user_local_storage";
import _ from "lodash";
import {
  useFolderHierarchyQuery,
  useDatasetsInFolderQuery,
  useDatasetSearchQuery,
  useCreateFolderMutation,
  useUpdateFolderMutation,
  useMoveFolderMutation,
  useDeleteFolderMutation,
  useUpdateDatasetMutation,
  useFolderQuery,
} from "./queries";
import { useIsMutating } from "@tanstack/react-query";
import { usePrevious } from "libs/react_hooks";

type Options = {
  datasetFilteringMode?: DatasetFilteringMode;
  applyUpdatePredicate?: (datasets: Array<APIMaybeUnimportedDataset>) => boolean;
  isCalledFromCheckDatasets?: boolean;
};
export type DatasetCollectionContextValue = {
  datasets: Array<APIMaybeUnimportedDataset>;
  isLoading: boolean;
  isChecking: boolean;
  checkDatasets: () => Promise<void>;
  fetchDatasets: (options?: Options) => Promise<void>;
  reloadDataset: (
    datasetId: APIDatasetId,
    datasetsToUpdate?: Array<APIMaybeUnimportedDataset>,
  ) => Promise<void>;
  updateCachedDataset: (dataset: APIDataset) => Promise<void>;
  activeFolderId: string | null;
  setActiveFolderId: (id: string | null) => void;
  mostRecentlyUsedActiveFolderId: string | null;
  supportsFolders: true;
  selectedDatasets: APIMaybeUnimportedDataset[];
  setSelectedDatasets: React.Dispatch<React.SetStateAction<APIMaybeUnimportedDataset[]>>;
  globalSearchQuery: string | null;
  setGlobalSearchQuery: (val: string | null) => void;
  searchRecursively: boolean;
  setSearchRecursively: (val: boolean) => void;
  getBreadcrumbs: (dataset: APIMaybeUnimportedDataset) => string[] | null;
  showCreateFolderPrompt: (parentFolderId: string) => void;
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
};

export const DatasetCollectionContext = createContext<DatasetCollectionContextValue | undefined>(
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

export default function DatasetCollectionContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeFolderId, setActiveFolderId] = useState<string | null>(
    UserLocalStorage.getItem(ACTIVE_FOLDER_ID_STORAGE_KEY) || null,
  );
  const mostRecentlyUsedActiveFolderId = usePrevious(activeFolderId, true);
  const [isChecking, setIsChecking] = useState(false);
  const isMutating = useIsMutating() > 0;
  const { data: folder } = useFolderQuery(activeFolderId);

  const [selectedDatasets, setSelectedDatasets] = useState<APIMaybeUnimportedDataset[]>([]);
  const [globalSearchQuery, setGlobalSearchQueryInner] = useState<string | null>(null);
  const setGlobalSearchQuery = useCallback(
    (value: string | null) => {
      // Empty string should be handled as null
      setGlobalSearchQueryInner(value ? value : null);
    },
    [setGlobalSearchQueryInner],
  );
  const [searchRecursively, setSearchRecursively] = useState<boolean>(true);

  // Keep url GET parameters in sync with search and active folder
  useManagedUrlParams(
    setGlobalSearchQuery,
    setActiveFolderId,
    globalSearchQuery,
    activeFolderId,
    searchRecursively,
    setSearchRecursively,
  );

  useEffect(() => {
    // Persist last active folder to localStorage. We
    // check folder against null to avoid that invalid ids are persisted.
    if (activeFolderId != null && folder != null) {
      UserLocalStorage.setItem(ACTIVE_FOLDER_ID_STORAGE_KEY, activeFolderId);
    } else {
      UserLocalStorage.removeItem(ACTIVE_FOLDER_ID_STORAGE_KEY);
    }
  }, [folder, activeFolderId]);

  const folderHierarchyQuery = useFolderHierarchyQuery();
  const datasetsInFolderQuery = useDatasetsInFolderQuery(
    globalSearchQuery == null ? activeFolderId : null,
  );
  const datasetSearchQuery = useDatasetSearchQuery(
    globalSearchQuery,
    activeFolderId,
    searchRecursively,
  );
  const createFolderMutation = useCreateFolderMutation();
  const deleteFolderMutation = useDeleteFolderMutation();
  const updateFolderMutation = useUpdateFolderMutation();
  const moveFolderMutation = useMoveFolderMutation();
  const updateDatasetMutation = useUpdateDatasetMutation(
    globalSearchQuery == null ? activeFolderId : null,
  );
  const datasets = (globalSearchQuery ? datasetSearchQuery.data : datasetsInFolderQuery.data) || [];

  const showCreateFolderPrompt = useCallback((parentFolderId: string) => {
    const folderName = prompt("Please input a name for the new folder", "New folder");
    if (!folderName) {
      // The user hit escape/cancel
      return;
    }
    createFolderMutation.mutateAsync([parentFolderId, folderName]);
  }, []);

  async function fetchDatasets(_options: Options = {}): Promise<void> {
    datasetsInFolderQuery.refetch();
  }

  async function reloadDataset(
    datasetId: APIDatasetId,
    _datasetsToUpdate?: Array<APIMaybeUnimportedDataset>,
  ) {
    updateDatasetMutation.mutateAsync(datasetId);
  }

  async function updateCachedDataset(dataset: APIDataset) {
    updateDatasetMutation.mutateAsync([dataset, dataset.folderId]);
  }

  const getBreadcrumbs = (dataset: APIMaybeUnimportedDataset) => {
    if (folderHierarchyQuery.data?.itemById == null) {
      return null;
    }
    const { itemById } = folderHierarchyQuery.data;

    let currentFolder = itemById.get(dataset.folderId);
    if (currentFolder == null) {
      console.warn("Breadcrumbs could not be computed.");
      return [];
    }
    const breadcrumbs = [currentFolder.title];
    while (currentFolder?.parent != null) {
      currentFolder = itemById.get(currentFolder.parent);
      if (currentFolder == null) {
        console.warn("Breadcrumbs could not be computed.");
        return [];
      }
      breadcrumbs.unshift(currentFolder.title);
    }

    return breadcrumbs;
  };

  const isLoading =
    (globalSearchQuery
      ? datasetSearchQuery.isFetching
      : folderHierarchyQuery.isLoading ||
        datasetsInFolderQuery.isFetching ||
        datasetsInFolderQuery.isRefetching) || isMutating;

  const value: DatasetCollectionContextValue = useMemo(
    () => ({
      supportsFolders: true as true,
      datasets,
      isLoading,
      fetchDatasets,
      reloadDataset,
      updateCachedDataset,
      activeFolderId,
      setActiveFolderId,
      mostRecentlyUsedActiveFolderId,
      showCreateFolderPrompt,
      isChecking,
      getBreadcrumbs,
      checkDatasets: async () => {
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
              triggerDatasetCheck(datastore.url).catch(() => {}),
          ),
        );
        setIsChecking(false);

        datasetsInFolderQuery.refetch();
      },
      selectedDatasets,
      setSelectedDatasets,
      globalSearchQuery,
      setGlobalSearchQuery,
      searchRecursively,
      setSearchRecursively,
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
    }),
    [
      isChecking,
      datasets,
      isLoading,
      showCreateFolderPrompt,
      fetchDatasets,
      reloadDataset,
      updateCachedDataset,
      activeFolderId,
      setActiveFolderId,
      mostRecentlyUsedActiveFolderId,
      folderHierarchyQuery,
      datasetsInFolderQuery,
      datasetSearchQuery,
      searchRecursively,
      setSearchRecursively,
      createFolderMutation,
      deleteFolderMutation,
      updateFolderMutation,
      moveFolderMutation,
      updateDatasetMutation,
      selectedDatasets,
      setSelectedDatasets,
      globalSearchQuery,
    ],
  );

  return (
    <DatasetCollectionContext.Provider value={value}>{children}</DatasetCollectionContext.Provider>
  );
}

function useManagedUrlParams(
  setGlobalSearchQuery: (value: string | null) => void,
  setActiveFolderId: React.Dispatch<React.SetStateAction<string | null>>,
  globalSearchQuery: string | null,
  activeFolderId: string | null,
  searchRecursively: boolean,
  setSearchRecursively: (val: boolean) => void,
) {
  const { data: folder } = useFolderQuery(activeFolderId);

  // Read params upon component mount.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const query = params.get("query");
    if (query) {
      setGlobalSearchQuery(query);
    }
    const folderId = params.get("folderId");
    if (folderId) {
      setActiveFolderId(folderId);
    }
    const recursive = params.get("recursive");
    setSearchRecursively(!!recursive);

    const folderSpecifier = _.last(location.pathname.split("/"));

    if (folderSpecifier?.includes("-")) {
      const nameChunksAndFolderId = folderSpecifier.split("-");
      const folderId = _.last(nameChunksAndFolderId);
      if (folderId) {
        setActiveFolderId(folderId);
      }
    }
  }, []);

  // Update query and searchRecursively

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
      // Don't use useHistory because this would lose the input search
      // focus.
      window.history.replaceState(
        {},
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
          params.delete("recursive");
        }
      } else {
        params.delete("folderId");
        params.delete("recursive");
      }
      const paramStr = params.toString();

      // Don't use useHistory because this would lose the input search
      // focus.
      window.history.replaceState(
        {},
        "",
        `/dashboard/datasets${paramStr === "" ? "" : "?"}${paramStr}`,
      );
    }
  }, [globalSearchQuery, activeFolderId, folder, searchRecursively]);
}
