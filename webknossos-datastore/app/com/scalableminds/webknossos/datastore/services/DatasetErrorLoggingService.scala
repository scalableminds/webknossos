package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class DatasetErrorLoggingService @Inject()(
    val lifecycle: ApplicationLifecycle,
    @Named("webknossos-datastore") val system: ActorSystem)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with LazyLogging {

  private val errorCountThresholdPerDataset = 5

  override protected def tickerInterval: FiniteDuration = 60 minutes

  override protected def tickerInitialDelay: FiniteDuration = tickerInterval

  // Not doing any synchronization here since wrong counts don’t do much harm, and synchronizing would be slow
  private val recentErrors: scala.collection.mutable.Map[(String, String), Int] = scala.collection.mutable.Map()

  def shouldLog(organizationId: String, datasetName: String): Boolean =
    recentErrors.getOrElse((organizationId, datasetName), 0) < errorCountThresholdPerDataset

  def registerLogged(organizationId: String, datasetName: String): Unit = {
    val previousErrorCount = recentErrors.getOrElse((organizationId, datasetName), 0)
    if (previousErrorCount >= errorCountThresholdPerDataset - 1) {
      logger.info(
        s"Got >= $errorCountThresholdPerDataset bucket loading errors for dataset $organizationId/$datasetName, muting them until next reset (interval = $tickerInterval) or dataset reload")
    }
    recentErrors((organizationId, datasetName)) = previousErrorCount + 1
  }

  def clearForDataset(organizationId: String, datasetName: String): Unit =
    recentErrors.remove((organizationId, datasetName))

  override protected def tick(): Unit = recentErrors.clear()
}
