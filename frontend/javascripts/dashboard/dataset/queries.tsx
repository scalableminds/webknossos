import _ from "lodash";
import React, { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Utils from "libs/utils";
import { getDataset, getDatasets, updateDataset } from "admin/admin_rest_api";
import {
  createFolder,
  deleteFolder,
  getFolder,
  getFolderTree,
  moveFolder,
  updateFolder,
} from "admin/api/folders";
import Toast from "libs/toast";
import { useEffect, useRef } from "react";
import {
  APIDataset,
  APIDatasetId,
  APIMaybeUnimportedDataset,
  FlatFolderTreeItem,
  Folder,
  FolderUpdater,
} from "types/api_flow_types";
import { handleGenericError } from "libs/error_handling";

export const SEARCH_RESULTS_LIMIT = 100;
export const MINIMUM_SEARCH_QUERY_LENGTH = 3;

export function useFolderQuery(folderId: string | null) {
  const queryKey = ["folders", folderId];
  return useQuery(
    queryKey,
    () => {
      if (folderId == null) {
        throw new Error("No folder id provided");
      }
      return getFolder(folderId);
    },
    {
      refetchOnWindowFocus: false,
      enabled: folderId != null,
    },
  );
}

export function useDatasetSearchQuery(query: string | null) {
  const queryKey = ["dataset", "search", query];
  return useQuery(
    queryKey,
    async () => {
      if (query == null || query.length < MINIMUM_SEARCH_QUERY_LENGTH) {
        return [];
      }
      return await getDatasets(null, null, query, SEARCH_RESULTS_LIMIT);
    },
    {
      refetchOnWindowFocus: false,
      enabled: query != null,
    },
  );
}

export function useFolderTreeQuery() {
  return useQuery(["folders"], getFolderTree, {
    refetchOnWindowFocus: false,
  });
}

const LIST_REQUEST_DURATION_THRESHOLD = 1000;
export function useDatasetsInFolderQuery(folderId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ["datasetsByFolder", folderId];
  const fetchedDatasetsRef = useRef<APIMaybeUnimportedDataset[] | null>(null);

  const queryData = useQuery(
    queryKey,
    () => {
      if (folderId == null) {
        // There should always be a folderId, but since hooks cannot
        // be used within conditionals, we allow folderId to be null.
        return Promise.resolve([]);
      }

      if (fetchedDatasetsRef.current != null) {
        const datasets = fetchedDatasetsRef.current;
        // Clear the pre-fetched datasets so that future refetches don't
        // reuse this value (e.g., when the user clicks on refresh).
        fetchedDatasetsRef.current = null;
        return datasets;
      }

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
    getDatasets(null, folderId).then((newDatasets) => {
      if (ignoreFetchResult) {
        return;
      }
      const requestDuration = performance.now() - startTime;

      const acceptNewDatasets = () => {
        if (ignoreFetchResult) {
          return;
        }
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
      fetchedDatasetsRef.current = null;
      ignoreFetchResult = true;
      Toast.close(`new-datasets-are-available-${folderId || null}`);
    };
  }, [folderId]);

  return queryData;
}

export function useCreateFolderMutation() {
  const queryClient = useQueryClient();
  const mutationKey = ["folders"];

  return useMutation(([parentId, name]: [string, string]) => createFolder(parentId, name), {
    mutationKey,
    onSuccess: (newFolder) => {
      queryClient.setQueryData(mutationKey, (oldItems: Folder[] | undefined) =>
        (oldItems || []).concat([newFolder]),
      );
    },
    onError: (err: any) => {
      handleGenericError(err, "Could not create folder. Check the console for details");
    },
  });
}

export function useDeleteFolderMutation() {
  const queryClient = useQueryClient();
  const mutationKey = ["folders"];

  return useMutation((id: string) => deleteFolder(id), {
    mutationKey,
    onSuccess: (deletedId) => {
      queryClient.setQueryData(mutationKey, (oldItems: Folder[] | undefined) =>
        (oldItems || []).filter((folder: Folder) => folder.id !== deletedId),
      );
    },
    onError: (err: any) => {
      handleGenericError(err, "Could not delete folder. Check the console for details");
    },
  });
}

export function useUpdateFolderMutation() {
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
      queryClient.setQueryData(["folders", updatedFolder.id], updatedFolder);
    },
    onError: (err: any) => {
      handleGenericError(err, "Could not update folder. Check the console for details");
    },
  });
}

export function useMoveFolderMutation() {
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
      onError: (err: any, _params, context) => {
        // Restore the old folder tree. Note that without the optimistic update
        // and the data reversion here, the sidebar would still show the (incorrectly)
        // moved folder, because the <SortableTree /> component does its own kind of
        // optimistic mutation by updating its state immediately when dragging a folder.
        handleGenericError(err, "Could not update folder. Check the console for details");

        if (context) {
          queryClient.setQueryData(mutationKey, context.previousFolders);
        }
      },
    },
  );
}

export function useUpdateDatasetMutation(folderId: string | null) {
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
      oldDataset.name === updatedDataset.name
        ? // Don't update lastUsedByUser, since this can lead to annoying reorderings in the table.
          { ...updatedDataset, lastUsedByUser: oldDataset.lastUsedByUser }
        : oldDataset,
    )
    .filter((dataset: APIMaybeUnimportedDataset) => dataset.folderId === activeFolderId);
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
