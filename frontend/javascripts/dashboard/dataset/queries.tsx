import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type DatasetUpdater,
  getDataset,
  getDatasets,
  updateDatasetPartial,
} from "admin/admin_rest_api";
import {
  createFolder,
  deleteFolder,
  getFolder,
  getFolderTree,
  moveFolder,
  updateFolder,
} from "admin/api/folders";
import { handleGenericError } from "libs/error_handling";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import { useEffect, useRef } from "react";
import {
  type APIDataset,
  type APIDatasetCompact,
  type FlatFolderTreeItem,
  type Folder,
  type FolderItem,
  type FolderUpdater,
  convertDatasetToCompact,
} from "types/api_flow_types";

export const SEARCH_RESULTS_LIMIT = 100;
export const MINIMUM_SEARCH_QUERY_LENGTH = 3;
const FOLDER_TREE_REFETCH_INTERVAL = 30000;

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
      // Avoid default retry delay with exponential back-off
      // to shorten the delay after which webKnossos will switch
      // to the root folder.
      // This is relevant for the case where the current folder
      // does not exist, anymore (e.g., was deleted by somebody
      // else).
      retryDelay: 500,
    },
  );
}

export function useDatasetQuery(datasetId: string) {
  const queryKey = ["datasetById", datasetId];
  return useQuery(
    queryKey,
    () => {
      return getDataset(datasetId);
    },
    {
      refetchOnWindowFocus: false,
    },
  );
}

export function useDatasetSearchQuery(
  query: string | null,
  folderId: string | null,
  searchRecursively: boolean,
) {
  const queryKey = ["dataset", "search", query, "in", folderId, "recursive?", searchRecursively];
  return useQuery(
    queryKey,
    async () => {
      if (query == null || query.length < MINIMUM_SEARCH_QUERY_LENGTH) {
        return [];
      }
      return await getDatasets(null, folderId, query, searchRecursively, SEARCH_RESULTS_LIMIT);
    },
    {
      refetchOnWindowFocus: false,
      enabled: query != null,
    },
  );
}

async function fetchTreeHierarchy() {
  const flatTreeItems = await getFolderTree();
  return getFolderHierarchy(flatTreeItems);
}

export function useFolderHierarchyQuery() {
  return useQuery(["folders"], fetchTreeHierarchy, {
    refetchOnWindowFocus: false,
    refetchInterval: FOLDER_TREE_REFETCH_INTERVAL,
  });
}

const LIST_REQUEST_DURATION_THRESHOLD = 500;
const DATASET_POLLING_INTERVAL = 60 * 1000;
export function useDatasetsInFolderQuery(folderId: string | null) {
  /*
   * This query is a bit more complex. The default behavior of react-query
   * would be to show the cached data, fetch new data and then update the
   * data in-place.
   * However, this can easily lead to situations where the user clicks on something
   * and while doing so the list updates and the click ends up somewhere else.
   * Since this can be very annoying, we fetch the new datasets in the background
   * and do something of the following:
   * - update the list immediately if it's been empty before OR if the request
   *   was relatively fast (i.e., it's unrealistic that the user already clicked
   *   somewhere).
   * - ask the user if they want to update the list IF something changes
   * - do nothing (since the cache is up to date)
   *
   * We do this by disabling the main query by default and setting the data
   * manually. The main query will read its result from the prefetched
   * data (if available).
   *
   * **Note** that invalidateQueries() calls won't have a direct, visible effect
   * due to the above mechanism IF the query data is already rendered.
   * Therefore, queryClient.setQueryData() or datasetsInFolderQuery.refetch()
   * should be used instead in these scenarios.
   */

  const queryClient = useQueryClient();
  const queryKey = ["datasetsByFolder", folderId];
  const fetchedDatasetsRef = useRef<APIDatasetCompact[] | null>(null);

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

      return getDatasets(null, folderId);
    },
    {
      refetchOnWindowFocus: false,
      enabled: false,
    },
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: Needs investigation whether further dependencies are necessary.
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (queryData.data == null || queryData.data.length === 0) {
      // No data exists in the cache. Allow the query to fetch.
      queryData.refetch();
      return undefined;
    }

    let effectWasCancelled = false;
    const startTime = performance.now();
    getDatasets(null, folderId)
      .then((newDatasets) => {
        if (effectWasCancelled) {
          return;
        }
        const requestDuration = performance.now() - startTime;

        const acceptNewDatasets = () => {
          if (effectWasCancelled) {
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

        const oldDatasets = queryClient.getQueryData<APIDatasetCompact[]>(queryKey);
        const diff = diffDatasets(oldDatasets, newDatasets);
        if (diff.changed === 0 && diff.onlyInOld === 0 && diff.onlyInNew === 0) {
          // Nothing changed
          return;
        }

        Toast.info(
          <>
            {generateDiffMessage(diff)}{" "}
            <a href="#" onClick={acceptNewDatasets}>
              Show updated list.
            </a>
          </>,
          {
            key: `new-datasets-are-available-${folderId || null}`,
            timeout: DATASET_POLLING_INTERVAL / 2,
          },
        );
      })
      .then(() => {
        // The initial refresh of the dataset list is done and the
        // potential update toast will also be gone once the following
        // poll action is triggered (due to the timeout of the toast).
        //
        // Let's poll for dataset updates here to keep the dataset
        // objects up to date. This is especially helpful to avoid that
        // long running sessions show outdated data which can then be
        // mutated by the user while discarding other updates.
        // Problematic scenario example:
        // - user A opens folder F
        // - user B opens folder F
        // - user B adds a tag to a dataset D in F
        // - user A also adds a tag to D. however, this update won't reflect
        //   the tag added by B.
        // The problem can be mitigated by polling, since the scenario would
        // only occur, if the conflict happens in the same time window (defined
        // by the polling interval).

        function scheduleNextPoll() {
          timeoutId = setTimeout(async () => {
            if (timeoutId == null) {
              return;
            }
            const newDatasets = await getDatasets(null, folderId);
            const oldDatasets = (queryClient.getQueryData(queryKey) || []) as APIDatasetCompact[];
            queryClient.setQueryData(
              queryKey,
              getUnobtrusivelyUpdatedDatasets(newDatasets, oldDatasets),
            );

            if (!effectWasCancelled) {
              scheduleNextPoll();
            }
          }, DATASET_POLLING_INTERVAL);
        }

        scheduleNextPoll();
      });

    return () => {
      fetchedDatasetsRef.current = null;
      effectWasCancelled = true;
      if (timeoutId != null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
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
    onSuccess: (newFolder: Folder, [parentId]) => {
      queryClient.setQueryData(
        mutationKey,
        transformHierarchy((oldItems: FlatFolderTreeItem[] | undefined) =>
          (oldItems || []).concat([{ ...newFolder, parent: parentId, metadata: [] }]),
        ),
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
      queryClient.setQueryData(
        mutationKey,
        transformHierarchy((oldItems: FlatFolderTreeItem[] | undefined) =>
          (oldItems || []).filter((folder: FlatFolderTreeItem) => folder.id !== deletedId),
        ),
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
      queryClient.setQueryData(
        mutationKey,
        transformHierarchy((oldItems: FlatFolderTreeItem[] | undefined) =>
          (oldItems || []).map((oldFolder: FlatFolderTreeItem) =>
            oldFolder.id === updatedFolder.id
              ? {
                  ...updatedFolder,
                  parent: oldFolder.parent,
                }
              : oldFolder,
          ),
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

  const updater = (folderId: string, newParentId: string) =>
    transformHierarchy((oldItems: FlatFolderTreeItem[] | undefined) =>
      (oldItems || []).map((oldFolder: FlatFolderTreeItem) =>
        oldFolder.id === folderId
          ? {
              ...oldFolder,
              parent: newParentId,
            }
          : oldFolder,
      ),
    );

  return useMutation(
    ([folderId, newParentId]: [string, string]) => moveFolder(folderId, newParentId),
    {
      mutationKey,
      onMutate: ([folderId, newParentId]) => {
        // Optimistically update the folder with the new parent.
        const previousFolders = queryClient.getQueryData(mutationKey);
        queryClient.setQueryData(mutationKey, updater(folderId, newParentId));
        return {
          previousFolders,
        };
      },
      onSuccess: (updatedFolder, [folderId, newParentId]) => {
        // Use the returned updatedFolder to update the query data
        queryClient.setQueryData(mutationKey, updater(updatedFolder.id, newParentId));
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
  /*
   * This mutation can either trigger a simple refresh of the dataset
   * (only pass the APIDatasetId) or it can update the actual dataset
   * when the tuple [APIDatasetCompact, string] is passed.
   */
  const queryClient = useQueryClient();
  const mutationKey = ["datasetsByFolder", folderId];

  return useMutation(
    (params: [string, DatasetUpdater] | string) => {
      // If a APIDatasetId is provided, simply refetch the dataset
      // without any mutation so that it gets reloaded effectively.
      if (Array.isArray(params)) {
        const [id, updater] = params;
        return updateDatasetPartial(id, updater);
      }
      const datasetId = params;
      return getDataset(datasetId);
    },
    {
      mutationKey,
      onSuccess: (updatedDataset: APIDataset) => {
        queryClient.setQueryData(mutationKey, (oldItems: APIDatasetCompact[] | undefined) =>
          (oldItems || [])
            .map((oldDataset: APIDatasetCompact) => {
              return oldDataset.id === updatedDataset.id
                ? // Don't update lastUsedByUser, since this can lead to annoying reorderings in the table.
                  convertDatasetToCompact({
                    ...updatedDataset,
                    lastUsedByUser: oldDataset.lastUsedByUser,
                  })
                : oldDataset;
            })
            .filter((dataset: APIDatasetCompact) => dataset.folderId === folderId),
        );
        // Also update the cached dataset under the key "datasetById".
        queryClient.setQueryData(["datasetById", updatedDataset.id], updatedDataset);
        const targetFolderId = updatedDataset.folderId;
        if (targetFolderId !== folderId) {
          // The dataset was moved to another folder. Add the dataset to that target folder
          queryClient.setQueryData(
            ["datasetsByFolder", targetFolderId],
            (oldItems: APIDatasetCompact[] | undefined) => {
              if (oldItems == null) {
                // Don't update the query data, if it doesn't exist, yet.
                // Otherwise, this would lead to weird intermediate states
                // (i.e., moving a dataset to folder X and switching to X
                // will only show the moved dataset and a spinner; when loading
                // has finished, the page will be complete).
                return undefined;
              }
              return (
                oldItems
                  // The dataset shouldn't be in oldItems, but if it should be
                  // for some reason (e.g., a bug), we filter it away to avoid
                  // duplicates.
                  .filter((el) => el.id !== updatedDataset.id)
                  .concat([convertDatasetToCompact(updatedDataset)])
              );
            },
          );
        }
        // Invalidate all search results so that outdated data won't be shown.
        // We could also update the dataset instances in the cache, but this can
        // get complex quite fast. Mainly because the mutation of a dataset can affect
        // whether it will be found by a search (e.g., when a dataset is moved to another
        // folder).
        // Simply invalidating the search should be a clean solution for now.
        queryClient.invalidateQueries({
          queryKey: ["dataset", "search"],
        });
      },
      onError: (err: any) => {
        handleGenericError(err, "Could not update dataset.");
      },
    },
  );
}

function diffDatasets(
  oldDatasets: APIDatasetCompact[] | undefined,
  newDatasets: APIDatasetCompact[],
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
    oldDatasets.map((ds) => ds.id),
    newDatasets.map((ds) => ds.id),
  );

  const oldDatasetsDict = _.keyBy(oldDatasets, (ds) => ds.id);
  const newDatasetsDict = _.keyBy(newDatasets, (ds) => ds.id);

  const changedDatasets = both
    .map((id) => newDatasetsDict[id])
    .filter((newDataset) => {
      const oldDataset = oldDatasetsDict[newDataset.id];
      return !_.isEqualWith(oldDataset, newDataset, (oldValue, newValue, key) => {
        const didUpgradeToRenamableDS =
          !("directoryName" in oldValue) && "directoryName" in newValue; // TODO: Can be remove after a few weeks / months.
        if (key === "lastUsedByUser" || didUpgradeToRenamableDS) {
          // Ignore the lastUsedByUser timestamp when diffing datasets and migrating datasets to new renamable version.
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

export function generateDiffMessage(diff: {
  changed: number;
  onlyInOld: number;
  onlyInNew: number;
}) {
  const joinStrings = (a: string, b: string) => {
    if (a && b) {
      return `${a} ${b}`;
    }
    return `${a}${b}`;
  };
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
  return joinStrings(maybeNewAndChangedSentence, removedStr);
}

function getUnobtrusivelyUpdatedDatasets(
  newDatasets: APIDatasetCompact[],
  oldDatasets: APIDatasetCompact[],
): APIDatasetCompact[] {
  /*
   * Only update existing datasets from oldDatasets with the ones from new datasets, so that the rendered
   * dataset list doesn't change in size (which would cause annoying scroll jumps). Also, don't change the
   * lastUsedByUser property, as this would change the ordering when the default sorting is used.
   */

  const idFn = (dataset: APIDatasetCompact) => dataset.id;

  const newDatasetsById = _.keyBy(newDatasets, idFn);
  return oldDatasets.map((oldDataset) => {
    const newPendant = newDatasetsById[idFn(oldDataset)];
    if (!newPendant) {
      return oldDataset;
    }
    return {
      ...newPendant,
      lastUsedByUser: oldDataset.lastUsedByUser,
    };
  });
}

type FolderHierarchy = {
  tree: FolderItem[];
  itemById: Record<string, FolderItem>;
  flatItems: FlatFolderTreeItem[];
};

export function getFolderHierarchy(folderTree: FlatFolderTreeItem[]): FolderHierarchy {
  const roots: FolderItem[] = [];
  const itemById: Record<string, FolderItem> = {};
  for (const folderTreeItem of folderTree) {
    const treeItem = {
      key: folderTreeItem.id,
      title: folderTreeItem.name,
      isEditable: folderTreeItem.isEditable,
      parent: folderTreeItem.parent,
      metadata: folderTreeItem.metadata,
      children: [],
    };
    if (folderTreeItem.parent == null) {
      roots.push(treeItem);
    }
    itemById[folderTreeItem.id] = treeItem;
  }

  for (const folderTreeItem of folderTree) {
    if (folderTreeItem.parent != null) {
      itemById[folderTreeItem.parent].children.push(itemById[folderTreeItem.id]);
    }
  }

  for (const folderTreeItem of folderTree) {
    if (folderTreeItem.parent != null) {
      itemById[folderTreeItem.parent].children.sort((a, b) => a.title.localeCompare(b.title));
    }
  }

  return { tree: roots, itemById, flatItems: folderTree };
}

function transformHierarchy(
  mapNewToOld: (old: FlatFolderTreeItem[] | undefined) => FlatFolderTreeItem[],
) {
  /*
   * The backend responds with FlatFolderTreeItem[] to represent the folder directory.
   * The frontend maps this to a nested folder hierarchy (see getFolderHierarchy).
   * Optimistic updates are easier to compute on the FlatFolderTreeItem[] structure, though.
   * This function here can be used to create a function which maps from FolderHierarchy
   * to FolderHierarchy by passing a function which maps from FlatFolderTreeItem[] to FlatFolderTreeItem[].
   */
  return (oldHierarchy: FolderHierarchy | undefined) => {
    const oldItems = oldHierarchy?.flatItems;
    const newItems = mapNewToOld(oldItems);
    return getFolderHierarchy(newItems);
  };
}
