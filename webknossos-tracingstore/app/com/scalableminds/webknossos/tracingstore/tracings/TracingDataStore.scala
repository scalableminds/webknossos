package com.scalableminds.webknossos.tracingstore.tracings

import com.google.inject.Inject
import com.scalableminds.webknossos.tracingstore.TracingStoreConfig
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle

import scala.concurrent.Future

class TracingDataStore @Inject()(config: TracingStoreConfig, lifecycle: ApplicationLifecycle) extends LazyLogging {

  val healthClient = new FossilDBClient("healthCheckOnly", config)

  healthClient.checkHealth

  lazy val skeletons = new FossilDBClient("skeletons", config)

  lazy val skeletonUpdates = new FossilDBClient("skeletonUpdates", config)

  lazy val volumes = new FossilDBClient("volumes", config)

  lazy val volumeData = new FossilDBClient("volumeData", config)

  lazy val volumeUpdates = new FossilDBClient("volumeUpdates", config)

  def shutdown(): Unit = {
    healthClient.shutdown()
    skeletons.shutdown()
    skeletonUpdates.shutdown()
    volumes.shutdown()
    volumeData.shutdown()
    volumeUpdates.shutdown()
    ()
  }

  lifecycle.addStopHook { () =>
    Future.successful {
      logger.info("Closing TracingStore grpc channels...")
      shutdown()
    }
  }
}
