package models.dataset

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.typesafe.scalalogging.LazyLogging
import jakarta.inject.Inject
import org.apache.pekko.actor.ActorSystem
import play.api.i18n.MessagesProvider
import play.api.inject.ApplicationLifecycle

import scala.concurrent.duration._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

class RealPathScanService @Inject()(
    datasetService: DatasetService,
    datasetDAO: DatasetDAO,
    val actorSystem: ActorSystem,
    val lifecycle: ApplicationLifecycle)(implicit val ec: ExecutionContext, mp: MessagesProvider)
    extends IntervalScheduler
    with LazyLogging
    with FoxImplicits {

  implicit private val ctx: DBAccessContext = GlobalAccessContext

  override protected def tickerInterval: FiniteDuration = 1 minute

  override protected def tick(): Fox[_] = {
    logger.info("Scanning realpaths for all virtual datasets...")
    for {
      datasets <- datasetDAO.findAll
      datasetsByDataStore: Map[String, List[Dataset]] = datasets.groupBy(_._dataStore)
      _ <- Fox.serialCombined(datasetsByDataStore.keys) { dataStoreName =>
        scanRealPathsForDatasetsOfDataStore(datasetsByDataStore(dataStoreName))
      }
      _ = logger.info("Done scanning realpaths for all virtual datasets.")
    } yield ()
  }

  private def scanRealPathsForDatasetsOfDataStore(datasets: Seq[Dataset]): Fox[Unit] =
    if (datasets.isEmpty) Fox.successful(())
    else {
      for {
        firstDataset <- datasets.headOption.toFox
        dataSourceBoxes <- Fox.fromFuture(Fox.serialSequence(datasets)(datasetService.usableDataSourceFor))
        dataSources = dataSourceBoxes.flatten
        client <- datasetService.clientFor(firstDataset)
        _ <- client.scanRealPathsForVirtual(dataSources)
      } yield ()
    }
}
