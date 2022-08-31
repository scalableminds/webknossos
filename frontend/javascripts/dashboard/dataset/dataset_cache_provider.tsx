import React, { createContext, useMemo, useState } from "react";
import type { DatasetFilteringMode } from "dashboard/dataset_view";
import type { APIMaybeUnimportedDataset, APIDatasetId, APIDataset } from "types/api_flow_types";
import {
  getDatastores,
  triggerDatasetCheck,
  getDatasets,
  getDataset,
  updateDataset,
} from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import UserLocalStorage from "libs/user_local_storage";
import * as Utils from "libs/utils";
type Options = {
  datasetFilteringMode?: DatasetFilteringMode;
  applyUpdatePredicate?: (datasets: Array<APIMaybeUnimportedDataset>) => boolean;
  isCalledFromCheckDatasets?: boolean;
};
type Context = {
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
};
const oldWkDatasetsCacheKey = "wk.datasets";
const wkDatasetsCacheKey = "wk.datasets-v2";
export const datasetCache = {
  set(datasets: APIMaybeUnimportedDataset[]): void {
    UserLocalStorage.setItem(wkDatasetsCacheKey, JSON.stringify(datasets));
  },

  get(): APIMaybeUnimportedDataset[] {
    return (
      Utils.parseAsMaybe(UserLocalStorage.getItem(wkDatasetsCacheKey))
        .getOrElse([]) // Ensuring that each dataset has tags.
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'dataset' implicitly has an 'any' type.
        .map((dataset) => ({ ...dataset, tags: dataset.tags || [] }))
    );
  },

  clear(): void {
    UserLocalStorage.removeItem(wkDatasetsCacheKey);
  },
};
export const DatasetCacheContext = createContext<Context>({
  datasets: [],
  isLoading: false,
  isChecking: false,
  fetchDatasets: async () => {},
  checkDatasets: async () => {},
  reloadDataset: async () => {},
  updateCachedDataset: async () => {},
});
export default function DatasetCacheProvider({ children }: { children: React.ReactNode }) {
  const [datasets, setDatasets] = useState(datasetCache.get());
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [pendingDatasetUpdates, setPendingDatasetUpdates] = useState<
    Record<string, Promise<APIDataset>>
  >({});

  async function fetchDatasets(options: Options = {}): Promise<void> {
    const isCalledFromCheckDatasets = options.isCalledFromCheckDatasets || false;
    const datasetFilteringMode = options.datasetFilteringMode || "onlyShowReported";

    const applyUpdatePredicate = options.applyUpdatePredicate || ((_datasets) => true);

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
      // Hotfix for https://github.com/scalableminds/webknossos/issues/5038
      // The deprecated cache key can still block a considerable amount of data in the localStorage (around 2 MB
      // for some wk instances while the localStorage quota is at 5 MB for Chrome).
      UserLocalStorage.removeItem(oldWkDatasetsCacheKey);
      UserLocalStorage.removeItem(oldWkDatasetsCacheKey, false);
      // Previously, the datasets key was used globally. Now, it's tied to the current organization,
      // which is why we can clear the global key (isOrganizationSpecific==false).
      UserLocalStorage.removeItem(wkDatasetsCacheKey, false);
      datasetCache.set(newDatasets);

      if (applyUpdatePredicate(newDatasets)) {
        setDatasets(newDatasets);
      }
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      setIsLoading(false);
    }
  }

  async function checkDatasets() {
    if (isLoading) return;

    try {
      setIsLoading(true);
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
      await fetchDatasets({
        isCalledFromCheckDatasets: true,
      });
      setIsChecking(false);
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      setIsLoading(false);
      setIsChecking(false);
    }
  }

  async function reloadDataset(
    datasetId: APIDatasetId,
    datasetsToUpdate?: Array<APIMaybeUnimportedDataset>,
  ) {
    if (isLoading) return;

    try {
      setIsLoading(true);
      const updatedDataset = await getDataset(datasetId);

      if (datasetsToUpdate) {
        const newDatasets: Array<APIMaybeUnimportedDataset> = datasetsToUpdate.map((dataset) => {
          if (
            dataset.name === datasetId.name &&
            dataset.owningOrganization === datasetId.owningOrganization
          ) {
            const { lastUsedByUser } = dataset;
            return { ...updatedDataset, lastUsedByUser };
          } else {
            return dataset;
          }
        });
        setDatasets(newDatasets);
      }

      const newInternalDatasets = datasets.map((dataset) => {
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
      handleGenericError(error as Error);
    } finally {
      setIsLoading(false);
    }
  }

  async function updateCachedDataset(dataset: APIDataset) {
    setIsLoading(true);
    const updatedDatasets = datasets.map((currentDataset) => {
      if (
        dataset.name === currentDataset.name &&
        dataset.owningOrganization === currentDataset.owningOrganization
      ) {
        return dataset;
      } else {
        return currentDataset;
      }
    });
    setDatasets(updatedDatasets);
    datasetCache.set(updatedDatasets);

    try {
      const previousDatasetUpdatePromise = pendingDatasetUpdates[dataset.name] || Promise.resolve();
      const newDatasetUpdatePromise = previousDatasetUpdatePromise.then(() =>
        updateDataset(dataset, dataset),
      );
      setPendingDatasetUpdates({
        ...pendingDatasetUpdates,
        [dataset.name]: newDatasetUpdatePromise,
      });
      await newDatasetUpdatePromise;
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      setIsLoading(false);
    }
  }

  const value = useMemo(
    () => ({
      datasets,
      isLoading,
      isChecking,
      checkDatasets,
      fetchDatasets,
      reloadDataset,
      updateCachedDataset,
    }),
    [
      datasets,
      isLoading,
      isChecking,
      checkDatasets,
      fetchDatasets,
      reloadDataset,
      updateCachedDataset,
    ],
  );

  return <DatasetCacheContext.Provider value={value}>{children}</DatasetCacheContext.Provider>;
}
