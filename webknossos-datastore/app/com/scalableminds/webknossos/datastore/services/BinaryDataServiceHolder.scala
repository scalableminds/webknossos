package com.scalableminds.webknossos.datastore.services

import java.nio.file.Paths
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.storage.DataVaultService

import javax.inject.Inject

/*
 * The BinaryDataService needs to be instantiated as singleton to provide a shared DataCubeCache.
 * There is, however an additional instance for volume tracings in the TracingStore
 * The TracingStore one (for VolumeTracings) already is a singleton, since the surrounding VolumeTracingService is a singleton.
 * The DataStore one is singleton-ized via this holder.
 */

class BinaryDataServiceHolder @Inject()(config: DataStoreConfig,
                                        agglomerateService: AgglomerateService,
                                        applicationHealthService: ApplicationHealthService,
                                        dataVaultService: DataVaultService,
                                        datasetErrorLoggingService: DatasetErrorLoggingService) {

  val binaryDataService: BinaryDataService = new BinaryDataService(
    Paths.get(config.Datastore.baseFolder),
    config.Datastore.Cache.DataCube.maxEntries,
    Some(agglomerateService),
    Some(dataVaultService),
    Some(applicationHealthService),
    Some(datasetErrorLoggingService)
  )

}
