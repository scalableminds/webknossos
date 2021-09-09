package com.scalableminds.webknossos.datastore.services

import com.scalableminds.webknossos.datastore.DataStoreConfig

import javax.inject.Inject

/*
 * The BinaryDataService needs to be instantiated as singleton to provide a shared DataCubeCache.
 * There is, however an additional instance for volume tracings in the TracingStore
 * The TracingStore one (for VolumeTracings) already is a singleton, since the surrounding VolumeTracingService is a singleton.
 * The DataStore one is singleton-ized via this holder.
 */

class BinaryDataServiceHolder @Inject()(config: DataStoreConfig, agglomerateService: AgglomerateService) {

  val binaryDataService = new BinaryDataService(
    Some(config),
    agglomerateService,
    config.Datastore.Cache.DataCube.maxEntries
  )

}
