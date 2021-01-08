// @flow
import React, { createContext, useState, type Node } from "react";

import type { DatasetFilteringMode } from "dashboard/dataset_view";
import type { APIMaybeUnimportedDataset, APIDatasetId } from "types/api_flow_types";
import { getDatastores, triggerDatasetCheck, getDatasets, getDataset } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import UserLocalStorage from "libs/user_local_storage";
import * as Utils from "libs/utils";

type Options = {
  datasetFilteringMode?: DatasetFilteringMode,
  applyUpdatePredicate?: (datasets: Array<APIMaybeUnimportedDataset>) => boolean,
  isCalledFromCheckDatasets?: boolean,
};

type Context = {
  datasets: Array<APIMaybeUnimportedDataset>,
  isLoading: boolean,
  checkDatasets: () => Promise<void>,
  fetchDatasets: (options?: Options) => Promise<void>,
  updateDataset: (
    datasetId: APIDatasetId,
    datasetsToUpdate?: Array<APIMaybeUnimportedDataset>,
  ) => Promise<void>,
};

const wkDatasetsCacheKey = "wk.datasets-v2";
export const datasetCache = {
  set(datasets: APIMaybeUnimportedDataset[]): void {
    UserLocalStorage.setItem(wkDatasetsCacheKey, JSON.stringify(datasets));
  },
  get(): APIMaybeUnimportedDataset[] {
    return Utils.parseAsMaybe(UserLocalStorage.getItem(wkDatasetsCacheKey)).getOrElse([]);
  },
  clear(): void {
    UserLocalStorage.removeItem(wkDatasetsCacheKey);
  },
};

export const DatasetCacheContext = createContext<Context>({
  datasets: [],
  isLoading: false,
  fetchDatasets: async () => {},
  checkDatasets: async () => {},
  updateDataset: async () => {},
});

export default function DatasetCacheProvider({ children }: { children: Node }) {
  const [datasets, setDatasets] = useState(datasetCache.get());
  const [isLoading, setIsLoading] = useState(false);
  async function fetchDatasets(options?: Options = {}): Promise<void> {
    const isCalledFromCheckDatasets = options.isCalledFromCheckDatasets || false;
    const datasetFilteringMode = options.datasetFilteringMode || "onlyShowReported";
    const applyUpdatePredicate = options.applyUpdatePredicate || (_datasets => true);

    if (isLoading && !isCalledFromCheckDatasets) return;

    try {
      setIsLoading(true);
      const mapFilterModeToUnreportedParameter = {
        showAllDatasets: null,
        onlyShowReported: false,
        onlyShowUnreported: true,
      };
      const newDatasets = await getDatasets(
        mapFilterModeToUnreportedParameter[datasetFilteringMode],
      );
      datasetCache.set(newDatasets);
      if (applyUpdatePredicate(newDatasets)) {
        setDatasets(newDatasets);
      }
    } catch (error) {
      handleGenericError(error);
    } finally {
      setIsLoading(false);
    }
  }
  async function checkDatasets() {
    if (isLoading) return;
    try {
      setIsLoading(true);
      const datastores = await getDatastores();
      await Promise.all(
        datastores
          .filter(ds => !ds.isForeign)
          .map(datastore =>
            // Catch potentially failing triggers, since these should not
            // block the subsequent fetch of datasets. Otherwise, one offline
            // datastore will stop the refresh for all datastores.
            triggerDatasetCheck(datastore.url).catch(() => {}),
          ),
      );
      await fetchDatasets({ isCalledFromCheckDatasets: true });
    } catch (error) {
      handleGenericError(error);
    } finally {
      setIsLoading(false);
    }
  }

  async function updateDataset(
    datasetId: APIDatasetId,
    datasetsToUpdate?: Array<APIMaybeUnimportedDataset>,
  ) {
    if (isLoading) return;
    try {
      setIsLoading(true);

      const updatedDataset = await getDataset(datasetId);

      if (datasetsToUpdate) {
        const newDatasets: Array<APIMaybeUnimportedDataset> = datasetsToUpdate.map(dataset => {
          if (
            dataset.name === datasetId.name &&
            dataset.owningOrganization === datasetId.owningOrganization
          ) {
            const { lastUsedByUser } = dataset;
            return {
              ...updatedDataset,
              lastUsedByUser,
            };
          } else {
            return dataset;
          }
        });
        setDatasets(newDatasets);
      }

      const newInternalDatasets = datasets.map(dataset => {
        if (
          dataset.name === datasetId.name &&
          dataset.owningOrganization === datasetId.owningOrganization
        ) {
          return updatedDataset;
        } else {
          return dataset;
        }
      });
      datasetCache.set(newInternalDatasets);
      if (!datasetsToUpdate) setDatasets(newInternalDatasets);
    } catch (error) {
      handleGenericError(error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <DatasetCacheContext.Provider
      value={{ datasets, isLoading, checkDatasets, fetchDatasets, updateDataset }}
    >
      {children}
    </DatasetCacheContext.Provider>
  );
}
