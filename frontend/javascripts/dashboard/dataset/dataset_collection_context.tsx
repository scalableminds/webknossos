import React, { createContext, useMemo, useState } from "react";
import type { DatasetFilteringMode } from "dashboard/dataset_view";
import type {
  APIMaybeUnimportedDataset,
  APIDatasetId,
  APIDataset,
  Folder,
} from "types/api_flow_types";
import { getDatasets, getDataset, updateDataset } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import Toast from "libs/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFolder,
  deleteFolder,
  getFolderTree,
  moveFolder,
  updateFolder,
} from "admin/api/folders";
type Options = {
  datasetFilteringMode?: DatasetFilteringMode;
  applyUpdatePredicate?: (datasets: Array<APIMaybeUnimportedDataset>) => boolean;
  isCalledFromCheckDatasets?: boolean;
};
export type DatasetCollectionContext = {
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

export const DatasetCollectionContext = createContext<DatasetCollectionContext>({
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
    useMoveFolderMutation: {},
  },
});

function useFolderTreeQuery() {
  return useQuery(["folders"], getFolderTree, {
    refetchOnWindowFocus: false,
  });
}

function useDatasetsInFolderQuery(folderId: string | null) {
  const queryKey = ["datasets", folderId];
  return useQuery(
    queryKey,
    () => (folderId == null ? Promise.resolve([]) : getDatasets(false, folderId)),
    {
      refetchOnWindowFocus: false,
    },
  );
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

  return useMutation((folder: Folder) => updateFolder(folder), {
    mutationKey,
    onSuccess: (updatedFolder) => {
      queryClient.setQueryData(mutationKey, (oldItems: Folder[] | undefined) =>
        (oldItems || []).map((oldFolder: Folder) =>
          oldFolder.id === updatedFolder.id
            ? {
                ...updatedFolder,
                // @ts-ignore todo: clean this up
                parent: oldFolder.parent,
              }
            : oldFolder,
        ),
      );
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
      onSuccess: (updatedFolder, [folderId, newParentId]) => {
        queryClient.setQueryData(mutationKey, (oldItems: Folder[] | undefined) =>
          (oldItems || []).map((oldFolder: Folder) =>
            oldFolder.id === updatedFolder.id
              ? {
                  ...updatedFolder,
                  // @ts-ignore todo: clean this up
                  parent: newParentId,
                }
              : oldFolder,
          ),
        );
      },
      onError: (err) => {
        Toast.error(`Could not update folder. ${err}`);
      },
    },
  );
}

function useUpdateDatasetMutation(folderId: string | null) {
  const queryClient = useQueryClient();
  const mutationKey = ["datasets", folderId];

  return useMutation(
    ([dataset, folderId]: [dataset: APIMaybeUnimportedDataset, folderId: string]) =>
      updateDataset(dataset, dataset, folderId),
    {
      mutationKey,
      onSuccess: (updatedDataset) => {
        console.log("setQueryData for", mutationKey);
        queryClient.setQueryData(
          mutationKey,
          (oldItems: APIMaybeUnimportedDataset[] | undefined) => {
            return (oldItems || [])
              .map((oldDataset: APIMaybeUnimportedDataset) =>
                oldDataset.name === updatedDataset.name
                  ? {
                      ...updatedDataset,
                      // @ts-ignore todo: clean this up
                      parent: oldDataset.parent,
                    }
                  : oldDataset,
              )
              .filter((dataset: APIMaybeUnimportedDataset) => dataset.folder.id === folderId);
          },
        );
        const targetFolderId = updatedDataset.folder.id;
        if (targetFolderId != folderId) {
          // The dataset was moved to another folder. Add the dataset to that target folder
          queryClient.setQueryData(
            ["datasets", targetFolderId],
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

export default function DatasetCollectionContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // const [datasets, setDatasets] = useState<APIMaybeUnimportedDataset[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [pendingDatasetUpdates, setPendingDatasetUpdates] = useState<
    Record<string, Promise<APIDataset>>
  >({});

  const queryClient = useQueryClient();
  const folderTreeQuery = useFolderTreeQuery();
  const datasetsInFolderQuery = useDatasetsInFolderQuery(activeFolderId);
  const createFolderMutation = useCreateFolderMutation();
  const deleteFolderMutation = useDeleteFolderMutation();
  const updateFolderMutation = useUpdateFolderMutation();
  const moveFolderMutation = useMoveFolderMutation();
  const updateDatasetMutation = useUpdateDatasetMutation(activeFolderId);
  const datasets = datasetsInFolderQuery.data || [];

  async function fetchDatasets(options: Options = {}): Promise<void> {
    queryClient.invalidateQueries({ queryKey: ["datasets", activeFolderId] });

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
    datasetsToUpdate?: Array<APIMaybeUnimportedDataset>,
  ) {
    // if (isLoading) return;
    // try {
    //   setIsLoading(true);
    //   const updatedDataset = await getDataset(datasetId);
    //   if (datasetsToUpdate) {
    //     const newDatasets: Array<APIMaybeUnimportedDataset> = datasetsToUpdate.map((dataset) => {
    //       if (
    //         dataset.name === datasetId.name &&
    //         dataset.owningOrganization === datasetId.owningOrganization
    //       ) {
    //         const { lastUsedByUser } = dataset;
    //         return { ...updatedDataset, lastUsedByUser };
    //       } else {
    //         return dataset;
    //       }
    //     });
    //     setDatasets(newDatasets);
    //   }
    //   const newInternalDatasets = datasets.map((dataset) => {
    //     if (
    //       dataset.name === datasetId.name &&
    //       dataset.owningOrganization === datasetId.owningOrganization
    //     ) {
    //       return updatedDataset;
    //     } else {
    //       return dataset;
    //     }
    //   });
    //   if (!datasetsToUpdate) setDatasets(newInternalDatasets);
    // } catch (error) {
    //   handleGenericError(error as Error);
    // } finally {
    //   setIsLoading(false);
    // }
  }

  async function updateCachedDataset(dataset: APIDataset) {
    updateDatasetMutation.mutateAsync([dataset, dataset.folder.id]);

    // setIsLoading(true);
    // const updatedDatasets = datasets.map((currentDataset) => {
    //   if (
    //     dataset.name === currentDataset.name &&
    //     dataset.owningOrganization === currentDataset.owningOrganization
    //   ) {
    //     return dataset;
    //   } else {
    //     return currentDataset;
    //   }
    // });
    // setDatasets(updatedDatasets);
    // try {
    //   const previousDatasetUpdatePromise = pendingDatasetUpdates[dataset.name] || Promise.resolve();
    //   const newDatasetUpdatePromise = previousDatasetUpdatePromise.then(() =>
    //     updateDataset(dataset, dataset),
    //   );
    //   setPendingDatasetUpdates({
    //     ...pendingDatasetUpdates,
    //     [dataset.name]: newDatasetUpdatePromise,
    //   });
    //   await newDatasetUpdatePromise;
    // } catch (error) {
    //   handleGenericError(error as Error);
    // } finally {
    //   setIsLoading(false);
    // }
  }

  const isLoading = datasetsInFolderQuery.isFetching;
  const value: DatasetCollectionContext = useMemo(
    () => ({
      datasets,
      isLoading,
      fetchDatasets,
      reloadDataset,
      updateCachedDataset,
      activeFolderId,
      setActiveFolderId,
      isChecking: false,
      checkDatasets: async () => {},
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
