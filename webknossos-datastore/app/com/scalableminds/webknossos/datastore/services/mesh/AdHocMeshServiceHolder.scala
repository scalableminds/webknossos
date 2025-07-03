package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.webknossos.datastore.services.BinaryDataService
import com.scalableminds.webknossos.datastore.services.mapping.MappingService
import org.apache.pekko.actor.ActorSystem

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

class AdHocMeshServiceHolder @Inject()(actorSystem: ActorSystem)(implicit ec: ExecutionContext) {
  var dataStoreAdHocMeshConfig: (BinaryDataService, MappingService, FiniteDuration, Int) = (null, null, null, 0)
  lazy val dataStoreAdHocMeshService: AdHocMeshService = new AdHocMeshService(dataStoreAdHocMeshConfig._1,
                                                                              dataStoreAdHocMeshConfig._2,
                                                                              actorSystem,
                                                                              dataStoreAdHocMeshConfig._3,
                                                                              dataStoreAdHocMeshConfig._4)

  var tracingStoreAdHocMeshConfig: (BinaryDataService, FiniteDuration, Int) = (null, null, 0)
  lazy val tracingStoreAdHocMeshService: AdHocMeshService = new AdHocMeshService(tracingStoreAdHocMeshConfig._1,
                                                                                 null,
                                                                                 actorSystem,
                                                                                 tracingStoreAdHocMeshConfig._2,
                                                                                 tracingStoreAdHocMeshConfig._3)

}
