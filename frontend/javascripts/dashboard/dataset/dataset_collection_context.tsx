import React, { createContext, useEffect, useMemo, useRef, useState } from "react";
import type { DatasetFilteringMode } from "dashboard/dataset_view";
import type {
  APIMaybeUnimportedDataset,
  APIDatasetId,
  APIDataset,
  Folder,
  FlatFolderTreeItem,
  FolderUpdater,
} from "types/api_flow_types";
import { getDatasets, getDataset, updateDataset } from "admin/admin_rest_api";
import Toast from "libs/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFolder,
  deleteFolder,
  getFolder,
  getFolderTree,
  moveFolder,
  updateFolder,
} from "admin/api/folders";
import UserLocalStorage from "libs/user_local_storage";
import * as Utils from "libs/utils";
import _ from "lodash";

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
  setActiveFolderId: (id: string) => void;
  queries: {
    folderTreeQuery: ReturnType<typeof useFolderTreeQuery>;
    datasetsInFolderQuery: ReturnType<typeof useDatasetsInFolderQuery>;
    createFolderMutation: ReturnType<typeof useCreateFolderMutation>;
    updateFolderMutation: ReturnType<typeof useUpdateFolderMutation>;
    moveFolderMutation: ReturnType<typeof useMoveFolderMutation>;
    deleteFolderMutation: ReturnType<typeof useDeleteFolderMutation>;
    updateDatasetMutation: ReturnType<typeof useUpdateDatasetMutation>;
  };
};

export const DatasetCollectionContext = createContext<DatasetCollectionContextValue>({
  datasets: [],
  isLoading: false,
  isChecking: false,
  fetchDatasets: async () => {},
  checkDatasets: async () => {},
  reloadDataset: async () => {},
  updateCachedDataset: async () => {},
  activeFolderId: null,
  setActiveFolderId: () => {},
  queries: {
    // @ts-ignore todo
    folderQuery: {},
    // @ts-ignore todo
    folderTreeQuery: {},
    // @ts-ignore todo
    datasetsInFolderQuery: {},
    // @ts-ignore todo
    createFolderMutation: {},
    // @ts-ignore todo
    updateFolderMutation: {},
    // @ts-ignore todo
    deleteFolderMutation: {},
    // @ts-ignore todo
    updateDatasetMutation: {},
    // @ts-ignore todo
    moveFolderMutation: {},
  },
});

export function useFolderQuery(folderId: string) {
  const queryKey = ["folders", folderId];
  return useQuery(queryKey, () => getFolder(folderId), {
    refetchOnWindowFocus: false,
  });
}

function useFolderTreeQuery() {
  return useQuery(["folders"], getFolderTree, {
    refetchOnWindowFocus: false,
  });
}

const LIST_REQUEST_DURATION_THRESHOLD = 1000;
function useDatasetsInFolderQuery(folderId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ["datasetsByFolder", folderId];
  const fetchedDatasetsRef = useRef<APIMaybeUnimportedDataset[] | null>(null);

  // console.log("[p] hook runs for", folderId);

  const queryData = useQuery(
    queryKey,
    () => {
      if (folderId == null) {
        // There should always be a folderId, but since hooks cannot
        // be used within conditionals, we allow folderId to be null.
        return Promise.resolve([]);
      }

      if (fetchedDatasetsRef.current != null) {
        // console.log(
        //   "[p] folderId",
        //   folderId,
        //   "using existing fetchedDatasetsRef.current",
        //   fetchedDatasetsRef.current,
        // );
        return fetchedDatasetsRef.current;
      }

      // console.log("[p] folderId", folderId, "getDatasets without prefetching");
      return getDatasets(false, folderId);
    },
    {
      refetchOnWindowFocus: false,
      enabled: false,
    },
  );

  useEffect(() => {
    if (queryData.data == null || queryData.data.length === 0) {
      // No data exists in the cache. Allow the query to fetch.
      // console.log("[p] refetch");
      queryData.refetch();
      return undefined;
    }

    let ignoreFetchResult = false;
    // console.log("[p] prefetch datasets");
    const startTime = performance.now();
    getDatasets(false, folderId).then((newDatasets) => {
      if (ignoreFetchResult) {
        // console.log("[p] ignore received datasets for", folderId);
        return;
      }
      const requestDuration = performance.now() - startTime;

      const acceptNewDatasets = () => {
        if (ignoreFetchResult) {
          // console.log("[p] ignore sleep for", folderId);
          return;
        }
        // console.log("[p] setFetchedDatasets", newDatasets);
        fetchedDatasetsRef.current = newDatasets;
        Toast.close(`new-datasets-are-available-${folderId || null}`);
        queryData.refetch();
      };

      // If the request was relatively fast, accept it without asking.
      // Otherwise, ask the user whether they want to accept the new results
      // since it would otherwise mean that the table content can change
      // suddenly which is quite annoying.
      if (requestDuration < LIST_REQUEST_DURATION_THRESHOLD) {
        acceptNewDatasets();
        return;
      }

      const oldDatasets = queryClient.getQueryData<APIDataset[]>(queryKey);
      const diff = diffDatasets(oldDatasets, newDatasets);
      if (diff.changed === 0 && diff.onlyInOld === 0 && diff.onlyInNew === 0) {
        // Nothing changed
        return;
      }

      const newOrChangedCount = diff.onlyInNew + diff.changed;
      const newStr = diff.onlyInNew > 0 ? `${diff.onlyInNew} new ` : "";
      const changedStr = diff.changed > 0 ? `${diff.changed} changed ` : "";
      const maybeAnd = changedStr && newStr ? "and " : "";
      const maybeAlso = newOrChangedCount ? "Also, " : "";
      const removedStr =
        diff.onlyInOld > 0
          ? `${maybeAlso}${diff.onlyInOld} ${Utils.pluralize(
              "dataset",
              diff.onlyInOld,
            )} no longer ${Utils.conjugate("exist", diff.onlyInOld)} in this folder.`
          : "";
      const maybeNewAndChangedSentence = newOrChangedCount
        ? `There ${Utils.conjugate(
            "are",
            newOrChangedCount,
            "is",
          )} ${newStr}${maybeAnd}${changedStr}${Utils.pluralize("dataset", newOrChangedCount)}.`
        : "";

      Toast.info(
        <>
          {maybeNewAndChangedSentence}
          {removedStr}{" "}
          <a href="#" onClick={acceptNewDatasets}>
            Show updated list.
          </a>
        </>,
        { key: `new-datasets-are-available-${folderId || null}` },
      );
    });

    return () => {
      // console.log("[p] clear effect for", folderId);
      fetchedDatasetsRef.current = null;
      ignoreFetchResult = true;
      Toast.close(`new-datasets-are-available-${folderId || null}`);
    };
  }, [folderId]);

  return queryData;
}

function useCreateFolderMutation() {
  const queryClient = useQueryClient();
  const mutationKey = ["folders"];

  return useMutation(([parentId, name]: [string, string]) => createFolder(parentId, name), {
    mutationKey,
    onSuccess: (newFolder) => {
      queryClient.setQueryData(mutationKey, (oldItems: Folder[] | undefined) =>
        (oldItems || []).concat([newFolder]),
      );
    },
    onError: (err) => {
      Toast.error(`Could not create folder. ${err}`);
    },
  });
}

function useDeleteFolderMutation() {
  const queryClient = useQueryClient();
  const mutationKey = ["folders"];

  return useMutation((id: string) => deleteFolder(id), {
    mutationKey,
    onSuccess: (deletedId) => {
      queryClient.setQueryData(mutationKey, (oldItems: Folder[] | undefined) =>
        (oldItems || []).filter((folder: Folder) => folder.id !== deletedId),
      );
    },
    onError: (err) => {
      Toast.error(`Could not delete folder. ${err}`);
    },
  });
}

function useUpdateFolderMutation() {
  const queryClient = useQueryClient();
  const mutationKey = ["folders"];

  return useMutation((folder: FolderUpdater) => updateFolder(folder), {
    mutationKey,
    onSuccess: (updatedFolder) => {
      queryClient.setQueryData(mutationKey, (oldItems: FlatFolderTreeItem[] | undefined) =>
        (oldItems || []).map((oldFolder: FlatFolderTreeItem) =>
          oldFolder.id === updatedFolder.id
            ? {
                ...updatedFolder,
                parent: oldFolder.parent,
              }
            : oldFolder,
        ),
      );
      queryClient.setQueryData(["folders", updatedFolder.id], undefined);
    },
    onError: (err) => {
      Toast.error(`Could not update folder. ${err}`);
    },
  });
}

function useMoveFolderMutation() {
  const queryClient = useQueryClient();
  const mutationKey = ["folders"];

  return useMutation(
    ([folderId, newParentId]: [string, string]) => moveFolder(folderId, newParentId),
    {
      mutationKey,
      onMutate: ([folderId, newParentId]) => {
        // Optimistically update the folder with the new parent.
        const previousFolders = queryClient.getQueryData(mutationKey);
        queryClient.setQueryData(mutationKey, (oldItems: FlatFolderTreeItem[] | undefined) =>
          (oldItems || []).map((oldFolder: FlatFolderTreeItem) =>
            oldFolder.id === folderId
              ? {
                  ...oldFolder,
                  parent: newParentId,
                }
              : oldFolder,
          ),
        );
        return {
          previousFolders,
        };
      },
      onSuccess: (updatedFolder, [folderId, newParentId]) => {
        // Use the returned updatedFolder to update the query data
        queryClient.setQueryData(mutationKey, (oldItems: FlatFolderTreeItem[] | undefined) =>
          (oldItems || []).map((oldFolder: FlatFolderTreeItem) =>
            oldFolder.id === updatedFolder.id
              ? {
                  ...updatedFolder,
                  parent: newParentId,
                }
              : oldFolder,
          ),
        );
        queryClient.setQueryData(["folders", folderId], () => updatedFolder);
      },
      onError: (err, _params, context) => {
        // Restore the old folder tree. Note that without the optimistic update
        // and the data reversion here, the sidebar would still show the (incorrectly)
        // moved folder, because the <SortableTree /> component does its own kind of
        // optimistic mutation by updating its state immediately when dragging a folder.
        Toast.error(`Could not update folder. ${err}`);
        if (context) {
          queryClient.setQueryData(mutationKey, context.previousFolders);
        }
      },
    },
  );
}

function useUpdateDatasetMutation(folderId: string | null) {
  const queryClient = useQueryClient();
  const mutationKey = ["datasetsByFolder", folderId];

  return useMutation(
    (params: [APIMaybeUnimportedDataset, string] | APIDatasetId) => {
      // If a APIDatasetId is provided, simply refetch the dataset
      // without any mutation so that it gets reloaded effectively.
      if ("owningOrganization" in params) {
        const datasetId = params;
        return getDataset(datasetId);
      }
      const [dataset, newFolderId] = params;
      return updateDataset(dataset, dataset, newFolderId, true);
    },
    {
      mutationKey,
      onSuccess: (updatedDataset) => {
        console.log("setQueryData for", mutationKey);
        queryClient.setQueryData(mutationKey, (oldItems: APIMaybeUnimportedDataset[] | undefined) =>
          updateDatasetInQueryData(updatedDataset, folderId, oldItems),
        );
        const targetFolderId = updatedDataset.folderId;
        if (targetFolderId !== folderId) {
          // The dataset was moved to another folder. Add the dataset to that target folder
          queryClient.setQueryData(
            ["datasetsByFolder", targetFolderId],
            (oldItems: APIMaybeUnimportedDataset[] | undefined) => {
              if (oldItems == null) {
                // Don't update the query data, if it doesn't exist, yet.
                // Otherwise, this would lead to weird intermediate states
                // (i.e., moving a dataset to folder X and switching to X
                // will only show the moved dataset and a spinner; when loading
                // has finished, the page will be complete).
                return undefined;
              }
              return oldItems.concat([updatedDataset]);
            },
          );
        }
      },
      onError: (err) => {
        Toast.error(`Could not update dataset. ${err}`);
      },
    },
  );
}

function updateDatasetInQueryData(
  updatedDataset: APIDataset,
  activeFolderId: string | null,
  oldItems: APIMaybeUnimportedDataset[] | undefined,
) {
  return (oldItems || [])
    .map((oldDataset: APIMaybeUnimportedDataset) =>
      oldDataset.name === updatedDataset.name ? updatedDataset : oldDataset,
    )
    .filter((dataset: APIMaybeUnimportedDataset) => dataset.folderId === activeFolderId);
}

const ACTIVE_FOLDER_ID_STORAGE_KEY = "activeFolderId";

export default function DatasetCollectionContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeFolderId, setActiveFolderId] = useState<string | null>(
    UserLocalStorage.getItem(ACTIVE_FOLDER_ID_STORAGE_KEY) || null,
  );

  const queryClient = useQueryClient();
  const folderTreeQuery = useFolderTreeQuery();
  const datasetsInFolderQuery = useDatasetsInFolderQuery(activeFolderId);
  const createFolderMutation = useCreateFolderMutation();
  const deleteFolderMutation = useDeleteFolderMutation();
  const updateFolderMutation = useUpdateFolderMutation();
  const moveFolderMutation = useMoveFolderMutation();
  const updateDatasetMutation = useUpdateDatasetMutation(activeFolderId);
  const datasets = datasetsInFolderQuery.data || [];

  useEffect(() => {
    if (activeFolderId != null) {
      UserLocalStorage.setItem(ACTIVE_FOLDER_ID_STORAGE_KEY, activeFolderId);
    }
  }, [activeFolderId]);

  async function fetchDatasets(_options: Options = {}): Promise<void> {
    queryClient.invalidateQueries({ queryKey: ["datasetsByFolder", activeFolderId] });

    // const isCalledFromCheckDatasets = options.isCalledFromCheckDatasets || false;
    // const datasetFilteringMode = options.datasetFilteringMode || "onlyShowReported";
    // const applyUpdatePredicate = options.applyUpdatePredicate || ((_datasets) => true);
    // if (isLoading && !isCalledFromCheckDatasets) return;
    // try {
    //   setIsLoading(true);
    //   const mapFilterModeToUnreportedParameter = {
    //     showAllDatasets: null,
    //     onlyShowReported: false,
    //     onlyShowUnreported: true,
    //   };
    //   const newDatasets = await getDatasets(
    //     mapFilterModeToUnreportedParameter[datasetFilteringMode],
    //   );
    //   if (applyUpdatePredicate(newDatasets)) {
    //     setDatasets(newDatasets);
    //   }
    // } catch (error) {
    //   handleGenericError(error as Error);
    // } finally {
    //   setIsLoading(false);
    // }
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

  const isLoading = datasetsInFolderQuery.isFetching || datasetsInFolderQuery.isRefetching;

  console.log("datasetsInFolderQuery.isLoading", datasetsInFolderQuery.isLoading);
  console.log("datasetsInFolderQuery.isFetching", datasetsInFolderQuery.isFetching);
  console.log("datasetsInFolderQuery.isRefetching", datasetsInFolderQuery.isRefetching);

  const value: DatasetCollectionContextValue = useMemo(
    () => ({
      datasets,
      isLoading,
      fetchDatasets,
      reloadDataset,
      updateCachedDataset,
      activeFolderId,
      setActiveFolderId,
      isChecking: false,
      checkDatasets: async () => {
        datasetsInFolderQuery.refetch();
      },
      queries: {
        folderTreeQuery,
        datasetsInFolderQuery,
        createFolderMutation,
        deleteFolderMutation,
        updateFolderMutation,
        moveFolderMutation,
        updateDatasetMutation,
      },
    }),
    [
      datasets,
      isLoading,
      fetchDatasets,
      reloadDataset,
      updateCachedDataset,
      activeFolderId,
      setActiveFolderId,
      folderTreeQuery,
      datasetsInFolderQuery,
      createFolderMutation,
      deleteFolderMutation,
      updateFolderMutation,
      moveFolderMutation,
      updateDatasetMutation,
    ],
  );

  return (
    <DatasetCollectionContext.Provider value={value}>{children}</DatasetCollectionContext.Provider>
  );
}

function diffDatasets(
  oldDatasets: APIMaybeUnimportedDataset[] | undefined,
  newDatasets: APIMaybeUnimportedDataset[],
): {
  changed: number;
  onlyInOld: number;
  onlyInNew: number;
} {
  if (oldDatasets == null) {
    return {
      changed: 0,
      onlyInOld: 0,
      onlyInNew: newDatasets.length,
    };
  }

  const {
    onlyA: onlyInOld,
    onlyB: onlyInNew,
    both,
  } = Utils.diffArrays(
    oldDatasets.map((ds) => ds.name),
    newDatasets.map((ds) => ds.name),
  );

  const oldDatasetsDict = _.keyBy(oldDatasets, (ds) => ds.name);
  const newDatasetsDict = _.keyBy(newDatasets, (ds) => ds.name);

  const changedDatasets = both
    .map((name) => newDatasetsDict[name])
    .filter((newDataset) => {
      const oldDataset = oldDatasetsDict[newDataset.name];
      return !_.isEqualWith(oldDataset, newDataset, (_objValue, _otherValue, key) => {
        if (key === "lastUsedByUser") {
          // Ignore the lastUsedByUser timestamp when diffing datasets.
          return true;
        }
        // Fallback to lodash's isEqual check.
        return undefined;
      });
    });

  return {
    changed: changedDatasets.length,
    onlyInOld: onlyInOld.length,
    onlyInNew: onlyInNew.length,
  };
}
