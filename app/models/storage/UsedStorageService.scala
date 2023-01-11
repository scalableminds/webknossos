package models.storage

import akka.actor.ActorSystem
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.DirectoryStorageReport
import com.typesafe.scalalogging.LazyLogging
import models.binary.{DataSet, DataSetService, DataStore, DataStoreDAO, WKRemoteDataStoreClient}
import models.organization.{Organization, OrganizationDAO}
import play.api.inject.ApplicationLifecycle
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class UsedStorageService @Inject()(val system: ActorSystem,
                                   val lifecycle: ApplicationLifecycle,
                                   organizationDAO: OrganizationDAO,
                                   dataSetService: DataSetService,
                                   dataStoreDAO: DataStoreDAO,
                                   rpc: RPC,
                                   config: WkConf)(implicit ec: ExecutionContext)
    extends LazyLogging
    with IntervalScheduler {

  /* Note that not every tick here will scan something, there is additional logic below:
     Every tick, et most 10 organizations are scanned. But only if their last full scan is was sufficiently long ago
     The 10 organizations with the most outdated scan are selected each tick. This is to distribute the load.
   */
  override protected def tickerInterval: FiniteDuration = 10 minutes
  override protected def tickerInitialDelay: FiniteDuration = 1 minute

  private val isRunning = new java.util.concurrent.atomic.AtomicBoolean(false)

  private val pauseAfterEachOrganization = 5 seconds
  private val organizationCountToScanPerTick = 10

  implicit private val ctx: DBAccessContext = GlobalAccessContext

  override protected def tick(): Unit =
    if (isRunning.compareAndSet(false, true)) {
      tickAsync().futureBox.onComplete { _ =>
        isRunning.set(false)
      }
    }

  private def tickAsync(): Fox[Unit] =
    for {
      organizations <- organizationDAO.findNotRecentlyScanned(config.WebKnossos.FetchUsedStorage.interval,
                                                              organizationCountToScanPerTick)
      dataStores <- dataStoreDAO.findAllWithStorageReporting
      _ = logger.info(s"Scanning ${organizations.length} organizations in ${dataStores.length} datastores...")
      _ <- Fox.serialCombined(organizations)(organization => refreshStorageReports(organization, dataStores))
    } yield ()

  private def refreshStorageReports(organization: Organization, dataStores: List[DataStore]): Fox[Unit] =
    for {
      storageReportsByDataStore <- Fox.serialCombined(dataStores)(dataStore =>
        refreshStorageReports(dataStore, organization))
      _ <- organizationDAO.deleteUsedStorage(organization._id)
      _ <- Fox.serialCombined(storageReportsByDataStore.zip(dataStores))(storageForDatastore =>
        upsertUsedStorage(organization, storageForDatastore))
      _ <- organizationDAO.updateLastStorageScanTime(organization._id, Instant.now)
      _ = Thread.sleep(pauseAfterEachOrganization.toMillis)
    } yield ()

  private def refreshStorageReports(dataStore: DataStore,
                                    organization: Organization): Fox[List[DirectoryStorageReport]] = {
    val dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
    dataStoreClient.fetchStorageReport(organization.name, datasetName = None)
  }

  private def upsertUsedStorage(organization: Organization,
                                storageReportsForDatastore: (List[DirectoryStorageReport], DataStore)): Fox[Unit] = {
    val dataStore = storageReportsForDatastore._2
    val storageReports = storageReportsForDatastore._1
    organizationDAO.upsertUsedStorage(organization._id, dataStore.name, storageReports)
  }

  def refreshStorageReportForDataset(dataset: DataSet): Fox[Unit] =
    for {
      dataStore <- dataSetService.dataStoreFor(dataset)
      dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
      organization <- organizationDAO.findOne(dataset._organization)
      report <- dataStoreClient.fetchStorageReport(organization.name, Some(dataset.name))
      _ <- organizationDAO.deleteUsedStorageForDataset(dataset._id)
      _ <- organizationDAO.upsertUsedStorage(organization._id, dataStore.name, report)
    } yield ()

}
