package com.scalableminds.webknossos.datastore.services

import akka.actor.ActorSystem
import javax.inject.Inject

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

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
