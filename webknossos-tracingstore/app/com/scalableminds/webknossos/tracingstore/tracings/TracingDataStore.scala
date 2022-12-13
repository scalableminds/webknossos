package com.scalableminds.webknossos.tracingstore.tracings

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.scalableminds.webknossos.tracingstore.TracingStoreConfig
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import scala.concurrent.duration._

import scala.concurrent.{ExecutionContext, Future}

class TracingDataStore @Inject()(config: TracingStoreConfig,
                                 lifecycle: ApplicationLifecycle,
                                 slackNotificationService: TSSlackNotificationService,
                                 val system: ActorSystem)(implicit ec: ExecutionContext)
    extends LazyLogging {

  val healthClient = new FossilDBClient("healthCheckOnly", config, slackNotificationService)

  system.scheduler.scheduleOnce(5 seconds)(healthClient.checkHealth)

  lazy val skeletons = new FossilDBClient("skeletons", config, slackNotificationService)

  lazy val skeletonUpdates = new FossilDBClient("skeletonUpdates", config, slackNotificationService)

  lazy val volumes = new FossilDBClient("volumes", config, slackNotificationService)

  lazy val volumeData = new FossilDBClient("volumeData", config, slackNotificationService)

  lazy val volumeUpdates = new FossilDBClient("volumeUpdates", config, slackNotificationService)

  lazy val editableMappings = new FossilDBClient("editableMappings", config, slackNotificationService)

  lazy val editableMappingUpdates = new FossilDBClient("editableMappingUpdates", config, slackNotificationService)

  def shutdown(): Unit = {
    healthClient.shutdown()
    skeletons.shutdown()
    skeletonUpdates.shutdown()
    volumes.shutdown()
    volumeData.shutdown()
    volumeUpdates.shutdown()
    editableMappings.shutdown()
    editableMappingUpdates.shutdown()
    ()
  }

  lifecycle.addStopHook { () =>
    Future.successful {
      logger.info("Closing TracingStore grpc channels...")
      shutdown()
    }
  }
}
