package com.scalableminds.webknossos.datastore.services

import java.nio.file.Paths

import com.scalableminds.webknossos.datastore.DataStoreConfig
import javax.inject.Inject

/*
 * The BinaryDataService needs to be instantiated as singleton to provide a shared DataCubeCache.
 * The TracingStore one (for VolumeTracings) already is, since the surrounding VolumeTracingService is a singleton.
 * The DataStore is singleton-ized via this holder.
 */

class DataServicesHolder @Inject()(config: DataStoreConfig) {

  val binaryDataService = new BinaryDataService(
    Paths.get(config.Braingames.Binary.baseFolder),
    config.Braingames.Binary.loadTimeout,
    config.Braingames.Binary.cacheMaxSize)

  val mappingService = new MappingService(
    Paths.get(config.Braingames.Binary.baseFolder),
    config.Braingames.Binary.mappingCacheMaxSize)

}
