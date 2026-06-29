package models.dataset

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.services.DataSourceWithRootPathInfo
import com.typesafe.scalalogging.LazyLogging
import jakarta.inject.Inject
import org.apache.pekko.actor.ActorSystem
import play.api.inject.ApplicationLifecycle

import scala.concurrent.duration._
import scala.concurrent.ExecutionContext

class VirtualDatasetsRealPathScanService @Inject() (
    datasetService: DatasetService,
    datasetDAO: DatasetDAO,
    val actorSystem: ActorSystem,
    val lifecycle: ApplicationLifecycle
)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with LazyLogging {

  implicit private val ctx: DBAccessContext = GlobalAccessContext

  override protected def tickerInterval: FiniteDuration = 1 hour

  override protected def tick(): Fox[?] = {
    logger.info("Scanning realpaths for all virtual datasets...")
    for {
      datasets <- datasetDAO.findAll
      datasetsByDataStore: Map[String, List[Dataset]] = datasets.filter(_.isVirtual).groupBy(_._dataStore)
      _ <- Fox.serialCombined(datasetsByDataStore.keys) { dataStoreName =>
        scanRealPathsForDatasetsOfDataStore(datasetsByDataStore(dataStoreName))
      }
    } yield ()
  }

  private def scanRealPathsForDatasetsOfDataStore(datasets: Seq[Dataset]): Fox[Unit] =
    if (datasets.isEmpty) Fox.successful(())
    else {
      for {
        firstDataset <- datasets.headOption.toFox
        // we skip unusable datasets
        dataSourceWithRootPathInfoBoxes <- Fox.fromFuture(
          Fox.serialSequence(datasets)(d =>
            datasetService
              .usableDataSourceFor(d, useRealPaths = false)
              .map(ds => DataSourceWithRootPathInfo(ds, d.rootPath, d.rootRealPath))
          )
        )
        dataSourcesWithRootPathInfo = dataSourceWithRootPathInfoBoxes.flatten
        client <- datasetService.clientFor(firstDataset)
        _ <- client.scanRealPathsForVirtual(dataSourcesWithRootPathInfo)
      } yield ()
    }

}
