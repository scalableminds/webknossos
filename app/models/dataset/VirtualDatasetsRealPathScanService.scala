package models.dataset

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.typesafe.scalalogging.LazyLogging
import jakarta.inject.Inject
import org.apache.pekko.actor.ActorSystem
import play.api.i18n.{Lang, MessagesApi, MessagesProvider}
import play.api.inject.ApplicationLifecycle

import scala.concurrent.duration._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

class VirtualDatasetsRealPathScanService @Inject()(
    datasetService: DatasetService,
    datasetDAO: DatasetDAO,
    messagesApi: MessagesApi,
    val actorSystem: ActorSystem,
    val lifecycle: ApplicationLifecycle)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with LazyLogging
    with FoxImplicits {

  implicit private val ctx: DBAccessContext = GlobalAccessContext
  implicit private val mp: MessagesProvider = messagesApi.preferred(Seq(Lang.defaultLang))

  override protected def tickerInterval: FiniteDuration = 1 minute

  override protected def tick(): Fox[_] = {
    logger.info("Scanning realpaths for all virtual datasets...")
    for {
      datasets <- datasetDAO.findAll
      datasetsByDataStore: Map[String, List[Dataset]] = datasets.filter(_.isVirtual).groupBy(_._dataStore)
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
