package com.scalableminds.webknossos.tracingstore.tracings

import org.apache.pekko.actor.ActorSystem
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

  system.scheduler.scheduleOnce(5 seconds)(healthClient.checkHealth(verbose = true))

  lazy val skeletons = new FossilDBClient("skeletons", config, slackNotificationService)

  lazy val skeletonUpdates = new FossilDBClient("skeletonUpdates", config, slackNotificationService)

  lazy val volumes = new FossilDBClient("volumes", config, slackNotificationService)

  lazy val volumeData = new FossilDBClient("volumeData", config, slackNotificationService)

  lazy val volumeSegmentIndex = new FossilDBClient("volumeSegmentIndex", config, slackNotificationService)

  lazy val volumeUpdates = new FossilDBClient("volumeUpdates", config, slackNotificationService)

  lazy val editableMappingsInfo = new FossilDBClient("editableMappingsInfo", config, slackNotificationService)

  lazy val editableMappingsAgglomerateToGraph =
    new FossilDBClient("editableMappingsAgglomerateToGraph", config, slackNotificationService)

  lazy val editableMappingsSegmentToAgglomerate =
    new FossilDBClient("editableMappingsSegmentToAgglomerate", config, slackNotificationService)

  lazy val editableMappingUpdates = new FossilDBClient("editableMappingUpdates", config, slackNotificationService)

  private def shutdown(): Unit = {
    healthClient.shutdown()
    skeletons.shutdown()
    skeletonUpdates.shutdown()
    volumes.shutdown()
    volumeData.shutdown()
    volumeUpdates.shutdown()
    editableMappingsInfo.shutdown()
    editableMappingsAgglomerateToGraph.shutdown()
    editableMappingsSegmentToAgglomerate.shutdown()
    editableMappingUpdates.shutdown()
    volumeSegmentIndex.shutdown()
    ()
  }

  lifecycle.addStopHook { () =>
    Future.successful {
      logger.info("Closing TracingStore grpc channels...")
      shutdown()
    }
  }
}
