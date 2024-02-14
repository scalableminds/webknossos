package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import javax.inject.Inject

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

class AdHocMeshingServiceHolder @Inject()(actorSystem: ActorSystem)(implicit ec: ExecutionContext) {
  var dataStoreAdHocMeshingConfig: (BinaryDataService, MappingService, FiniteDuration, Int) = (null, null, null, 0)
  lazy val dataStoreAdHocMeshingService: AdHocMeshService = new AdHocMeshService(dataStoreAdHocMeshingConfig._1,
                                                                                 dataStoreAdHocMeshingConfig._2,
                                                                                 actorSystem,
                                                                                 dataStoreAdHocMeshingConfig._3,
                                                                                 dataStoreAdHocMeshingConfig._4)

  var tracingStoreAdHocMeshingConfig: (BinaryDataService, FiniteDuration, Int) = (null, null, 0)
  lazy val tracingStoreAdHocMeshingService: AdHocMeshService = new AdHocMeshService(tracingStoreAdHocMeshingConfig._1,
                                                                                    null,
                                                                                    actorSystem,
                                                                                    tracingStoreAdHocMeshingConfig._2,
                                                                                    tracingStoreAdHocMeshingConfig._3)

}
