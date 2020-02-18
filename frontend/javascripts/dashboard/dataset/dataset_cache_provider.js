// @flow
import React, { createContext, useState, useEffect, type Node } from "react";
import { useHistory } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";

import type { APIMaybeUnimportedDataset } from "admin/api_flow_types";
import { getDatastores, triggerDatasetCheck, getDatasets } from "admin/admin_rest_api";
import { type DatasetFilteringMode } from "dashboard/dataset_view";
import { handleGenericError } from "libs/error_handling";
import UserLocalStorage from "libs/user_local_storage";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";

type Context = {
  datasets: Array<APIMaybeUnimportedDataset>,
  isLoading: boolean,
  checkDatasets: () => Promise<void>,
  fetchDatasets: (datasetFilteringMode?: DatasetFilteringMode) => Promise<void>,
};

type PersistenceState = {
  datasets: Array<APIMaybeUnimportedDataset>,
  isLoading: boolean,
  searchQuery: string,
  datasetFilteringMode: DatasetFilteringMode,
};

const persistence: Persistence<PersistenceState> = new Persistence(
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

const wkDatasetsCacheKey = "wk.datasets";
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
});

export default function DatasetCacheProvider({ children }: { children: Node }) {
  const [datasets, setDatasets] = useState(datasetCache.get());
  const [isLoading, setIsLoading] = useState(false);
  const history = useHistory();
  async function fetchDatasets(
    datasetFilteringMode?: DatasetFilteringMode = "onlyShowReported",
  ): Promise<void> {
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
      setDatasets(newDatasets);
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
        datastores.filter(ds => !ds.isForeign).map(datastore => triggerDatasetCheck(datastore.url)),
      );
      await fetchDatasets();
    } catch (error) {
      handleGenericError(error);
    } finally {
      setIsLoading(false);
    }
  }
  useEffect(() => {
    try {
      persistence.load(history);
    } catch (error) {
      console.error(error);
      // An unknown error was thrown. To avoid any problems with the caching of datasets,
      // we simply clear the cache for the datasets and re-fetch.
      setDatasets([]);
      datasetCache.clear();
    }
  }, []);
  return (
    <DatasetCacheContext.Provider value={{ datasets, isLoading, checkDatasets, fetchDatasets }}>
      {children}
    </DatasetCacheContext.Provider>
  );
}
