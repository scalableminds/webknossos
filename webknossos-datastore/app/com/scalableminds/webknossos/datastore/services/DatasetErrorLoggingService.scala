package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import com.google.inject.name.Named
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure, Full}
import play.api.inject.ApplicationLifecycle

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

trait DatasetErrorLoggingService extends IntervalScheduler with Formatter with LazyLogging with FoxImplicits {

  protected def applicationHealthService: Option[ApplicationHealthService]

  private val errorCountThresholdPerDataset = 5

  override protected def tickerInterval: FiniteDuration = 60 minutes

  override protected def tickerInitialDelay: FiniteDuration = tickerInterval

  // Not doing any synchronization here since wrong counts don’t do much harm, and synchronizing would be slow
  private val recentErrors: scala.collection.mutable.Map[(String, String), Int] = scala.collection.mutable.Map()

  private def shouldLog(organizationId: String, datasetName: String): Boolean =
    recentErrors.getOrElse((organizationId, datasetName), 0) < errorCountThresholdPerDataset

  private def registerLogged(organizationId: String, datasetName: String): Unit = {
    val previousErrorCount = recentErrors.getOrElse((organizationId, datasetName), 0)
    if (previousErrorCount >= errorCountThresholdPerDataset - 1) {
      logger.info(
        s"Got >= $errorCountThresholdPerDataset bucket loading errors for dataset $organizationId/$datasetName, muting them until next reset (interval = $tickerInterval) or dataset reload")
    }
    recentErrors((organizationId, datasetName)) = previousErrorCount + 1
  }

  def clearForDataset(organizationId: String, datasetName: String): Unit =
    recentErrors.remove((organizationId, datasetName))

  override protected def tick(): Fox[Unit] = Fox.successful(recentErrors.clear())

  def withErrorLoggingMultiple(dataSourceId: DataSourceId,
                               label: String,
                               resultFox: Fox[Seq[Box[Array[Byte]]]]): Fox[Seq[Box[Array[Byte]]]] =
    resultFox.shiftBox.flatMap {
      case Full(boxes) =>
        boxes.foreach(box => withErrorLogging(dataSourceId, label, box.toFox))
        Fox.successful(boxes)
      case other =>
        withErrorLogging(dataSourceId, label, resultFox.map(_ => Array[Byte]()))
        other.toFox
    }

  def withErrorLogging(dataSourceId: DataSourceId, label: String, resultFox: Fox[Array[Byte]]): Fox[Array[Byte]] =
    resultFox.shiftBox.flatMap {
      case Full(data) =>
        if (data.length == 0) {
          val msg = s"Zero-length array returned while $label for $dataSourceId"
          if (shouldLog(dataSourceId.organizationId, dataSourceId.directoryName)) {
            logger.warn(msg)
            registerLogged(dataSourceId.organizationId, dataSourceId.directoryName)
          }
          Fox.failure(msg)
        } else {
          Fox.successful(data)
        }
      case Failure(msg, Full(e: InternalError), _) =>
        logger.error(s"Caught internal error ($msg) while $label for $dataSourceId:", e)
        applicationHealthService.foreach(_.pushError(e))
        Fox.failure(msg, Full(e))
      case f: Failure =>
        if (shouldLog(dataSourceId.organizationId, dataSourceId.directoryName)) {
          logger.error(s"Error while $label for $dataSourceId: ${formatFailureChain(f, includeStackTraces = true)}")
          registerLogged(dataSourceId.organizationId, dataSourceId.directoryName)
        }
        f.toFox
      case other => other.toFox
    }

}

class DSDatasetErrorLoggingService @Inject()(
    val lifecycle: ApplicationLifecycle,
    dsApplicationHealthService: ApplicationHealthService,
    @Named("webknossos-datastore") val actorSystem: ActorSystem)(implicit val ec: ExecutionContext)
    extends DatasetErrorLoggingService {
  protected def applicationHealthService: Option[ApplicationHealthService] = Some(dsApplicationHealthService)
}
