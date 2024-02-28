import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type {
  APIDatasetId,
  APIDatasetCompact,
  APIDatasetCompactWithoutStatusAndLayerNames,
  FolderItem,
} from "types/api_flow_types";
import { DatasetUpdater, getDatastores, triggerDatasetCheck } from "admin/admin_rest_api";
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
import { useEffectOnlyOnce, usePrevious } from "libs/react_hooks";

export type DatasetCollectionContextValue = {
  datasets: Array<APIDatasetCompact>;
  isLoading: boolean;
  isChecking: boolean;
  checkDatasets: () => Promise<void>;
  fetchDatasets: () => void;
  reloadDataset: (
    datasetId: APIDatasetId,
    datasetsToUpdate?: Array<APIDatasetCompact>,
  ) => Promise<void>;
  updateCachedDataset: (id: APIDatasetId, updater: DatasetUpdater) => Promise<void>;
  activeFolderId: string | null;
  setActiveFolderId: (id: string | null) => void;
  mostRecentlyUsedActiveFolderId: string | null;
  supportsFolders: true;
  selectedDatasets: APIDatasetCompact[];
  selectedFolder: FolderItem | null;
  setSelectedFolder: (arg0: FolderItem | null) => void;
  setSelectedDatasets: React.Dispatch<React.SetStateAction<APIDatasetCompact[]>>;
  globalSearchQuery: string | null;
  setGlobalSearchQuery: (val: string | null) => void;
  searchRecursively: boolean;
  setSearchRecursively: (val: boolean) => void;
  getBreadcrumbs: (dataset: APIDatasetCompactWithoutStatusAndLayerNames) => string[] | null;
  getActiveSubfolders: () => FolderItem[];
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

  const [selectedDatasets, setSelectedDatasets] = useState<APIDatasetCompact[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<FolderItem | null>(null);
  const [globalSearchQuery, setGlobalSearchQueryInner] = useState<string | null>(null);
  const setGlobalSearchQuery = useCallback((value: string | null) => {
    // Empty string should be handled as null
    setGlobalSearchQueryInner(value ? value : null);
  }, []);
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

  const showCreateFolderPrompt = useCallback(
    (parentFolderId: string) => {
      const folderName = prompt("Please input a name for the new folder", "New folder");
      if (!folderName) {
        // The user hit escape/cancel
        return;
      }
      createFolderMutation.mutateAsync([parentFolderId, folderName]);
    },
    [createFolderMutation.mutateAsync],
  );

  function fetchDatasets(): void {
    datasetsInFolderQuery.refetch();
    datasetSearchQuery.refetch();
  }

  async function reloadDataset(datasetId: APIDatasetId) {
    await updateDatasetMutation.mutateAsync(datasetId);
  }

  async function updateCachedDataset(id: APIDatasetId, updater: DatasetUpdater) {
    await updateDatasetMutation.mutateAsync([id, updater]);
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
      : folderHierarchyQuery.isLoading ||
        datasetsInFolderQuery.isFetching ||
        datasetsInFolderQuery.isRefetching) || isMutating;

  const value: DatasetCollectionContextValue = useMemo(
    () => ({
      supportsFolders: true as const,
      datasets,
      isLoading,
      fetchDatasets,
      reloadDataset,
      updateCachedDataset,
      activeFolderId,
      setActiveFolderId,
      selectedFolder,
      setSelectedFolder,
      mostRecentlyUsedActiveFolderId,
      showCreateFolderPrompt,
      isChecking,
      getBreadcrumbs,
      getActiveSubfolders,
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
        datasetSearchQuery.refetch();
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
      activeFolderId,
      mostRecentlyUsedActiveFolderId,
      folderHierarchyQuery,
      datasetsInFolderQuery,
      datasetSearchQuery,
      searchRecursively,
      createFolderMutation,
      deleteFolderMutation,
      updateFolderMutation,
      moveFolderMutation,
      updateDatasetMutation,
      selectedDatasets,
      globalSearchQuery,
      getActiveSubfolders,
      getBreadcrumbs,
      selectedFolder,
      setGlobalSearchQuery,
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
  useEffectOnlyOnce(() => {
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
    if (recursive != null) setSearchRecursively(recursive === "true");

    const folderSpecifier = _.last(location.pathname.split("/"));

    if (folderSpecifier?.includes("-")) {
      const nameChunksAndFolderId = folderSpecifier.split("-");
      const folderId = _.last(nameChunksAndFolderId);
      if (folderId) {
        setActiveFolderId(folderId);
      }
    }
  });

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
          params.set("recursive", "false");
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
