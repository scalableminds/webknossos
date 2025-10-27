package com.scalableminds.webknossos.datastore.services

import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.services.mapping.AgglomerateService
import com.scalableminds.webknossos.datastore.storage.DataVaultService

import javax.inject.Inject
import scala.concurrent.ExecutionContext

/*
 * The BinaryDataService needs to be instantiated as singleton to provide a shared bucketProviderCache.
 * There is, however an additional instance for volume tracings in the TracingStore
 * The TracingStore one (for VolumeTracings) already is a singleton, since the surrounding VolumeTracingService is a singleton.
 * The DataStore one is singleton-ized via this holder.
 * Also, this allows giving the datastore-only sharedChunkContentsCache to the DataStore one, while passing None to the TracingStore one.
 */

class BinaryDataServiceHolder @Inject()(config: DataStoreConfig,
                                        dataVaultService: DataVaultService,
                                        datasetErrorLoggingService: DSDatasetErrorLoggingService,
                                        chunkCacheService: DSChunkCacheService,
                                        agglomerateService: AgglomerateService)(implicit ec: ExecutionContext) {

  val binaryDataService: BinaryDataService = new BinaryDataService(
    config.Datastore.baseDirectory,
    Some(agglomerateService),
    Some(dataVaultService),
    Some(chunkCacheService.sharedChunkContentsCache),
    datasetErrorLoggingService
  )

}
