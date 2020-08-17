package com.scalableminds.webknossos.datastore.services

import java.nio.file.Paths

import akka.actor.ActorSystem
import com.scalableminds.webknossos.datastore.DataStoreConfig
import javax.inject.Inject

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

/*
 * The BinaryDataService needs to be instantiated as singleton to provide a shared DataCubeCache.
 * There is, however an additional instance for volume tracings in the TracingStore
 * The TracingStore one (for VolumeTracings) already is a singleton, since the surrounding VolumeTracingService is a singleton.
 * The DataStore one is singleton-ized via this holder.
 */

class BinaryDataServiceHolder @Inject()(config: DataStoreConfig, agglomerateService: AgglomerateService) {

  val binaryDataService = new BinaryDataService(Paths.get(config.Braingames.Binary.baseFolder),
                                                config.Braingames.Binary.loadTimeout,
                                                config.Braingames.Binary.cacheMaxSize,
                                                agglomerateService)

}

class IsosurfaceServiceHolder @Inject()(actorSystem: ActorSystem)(implicit ec: ExecutionContext) {
  var dataStoreIsosurfaceConfig: (BinaryDataService, MappingService, FiniteDuration, Int) = (null, null, null, 0)
  lazy val dataStoreIsosurfaceService: IsosurfaceService = new IsosurfaceService(dataStoreIsosurfaceConfig._1,
                                                                                 dataStoreIsosurfaceConfig._2,
                                                                                 actorSystem,
                                                                                 dataStoreIsosurfaceConfig._3,
                                                                                 dataStoreIsosurfaceConfig._4)

  var tracingStoreIsosurfaceConfig: (BinaryDataService, FiniteDuration, Int) = (null, null, 0)
  lazy val tracingStoreIsosurfaceService: IsosurfaceService = new IsosurfaceService(tracingStoreIsosurfaceConfig._1,
                                                                                    null,
                                                                                    actorSystem,
                                                                                    tracingStoreIsosurfaceConfig._2,
                                                                                    tracingStoreIsosurfaceConfig._3)

}
