package com.scalableminds.webknossos.datastore.tracings

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle

import scala.concurrent.Future

class TracingDataStore @Inject()(config: DataStoreConfig,
                                 lifecycle: ApplicationLifecycle) extends LazyLogging {

  val healthClient = new FossilDBClient("healthCheckOnly", config)

  healthClient.checkHealth

  lazy val skeletons = new FossilDBClient("skeletons", config)

  lazy val skeletonUpdates = new FossilDBClient("skeletonUpdates", config)

  lazy val volumes = new FossilDBClient("volumes", config)

  lazy val volumeData = new FossilDBClient("volumeData", config)

  lazy val volumeUpdates = new FossilDBClient("volumeUpdates", config)

  def shutdown() = {
    healthClient.shutdown()
    skeletons.shutdown()
    skeletonUpdates.shutdown()
    volumes.shutdown()
    volumeData.shutdown()
    ()
  }

  lifecycle.addStopHook { () =>
    Future.successful {
      logger.info("Closing TracingStore grpc channels...")
      shutdown()
    }
  }
}
