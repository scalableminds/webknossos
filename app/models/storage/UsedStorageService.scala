package models.storage

import org.apache.pekko.actor.ActorSystem
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.DirectoryStorageReport
import com.typesafe.scalalogging.LazyLogging
import models.dataset.{Dataset, DatasetService, DataStore, DataStoreDAO, WKRemoteDataStoreClient}
import models.organization.{Organization, OrganizationDAO}
import com.scalableminds.util.tools.{Failure, Full}
import play.api.inject.ApplicationLifecycle
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class UsedStorageService @Inject()(val system: ActorSystem,
                                   val lifecycle: ApplicationLifecycle,
                                   organizationDAO: OrganizationDAO,
                                   datasetService: DatasetService,
                                   dataStoreDAO: DataStoreDAO,
                                   rpc: RPC,
                                   config: WkConf)(implicit val ec: ExecutionContext)
    extends LazyLogging
    with IntervalScheduler {

  /* Note that not every tick here will scan something, there is additional logic below:
     Every tick, et most scansPerTick organizations are scanned.
     But only if their last full scan is was sufficiently long ago
     The organizations with the most outdated scan are selected each tick. This is to distribute the load.
   */
  override protected def tickerInterval: FiniteDuration = config.WebKnossos.FetchUsedStorage.tickerInterval
  override protected def tickerInitialDelay: FiniteDuration = 1 minute

  private val isRunning = new java.util.concurrent.atomic.AtomicBoolean(false)

  private val pauseAfterEachOrganization = 5 seconds
  private val organizationCountToScanPerTick = config.WebKnossos.FetchUsedStorage.scansPerTick

  implicit private val ctx: DBAccessContext = GlobalAccessContext

  override protected def tick(): Unit =
    if (isRunning.compareAndSet(false, true)) {
      tickAsync().futureBox.onComplete { _ =>
        isRunning.set(false)
      }
    }

  private def tickAsync(): Fox[Unit] =
    for {
      organizations <- organizationDAO.findNotRecentlyScanned(config.WebKnossos.FetchUsedStorage.rescanInterval,
                                                              organizationCountToScanPerTick)
      dataStores <- dataStoreDAO.findAllWithStorageReporting
      _ = logger.info(s"Scanning used storage for ${organizations.length} organizations (${organizations
        .map(_._id)}) in ${dataStores.length} datastores (${dataStores.map(_.name)})...")
      _ <- Fox.serialCombined(organizations)(organization =>
        tryAndLog(organization._id, refreshStorageReports(organization, dataStores)))
    } yield ()

  private def tryAndLog(organizationId: String, result: Fox[Unit]): Fox[Unit] =
    for {
      box <- result.futureBox
      _ = box match {
        case Full(_)    => ()
        case f: Failure => logger.error(f"Error during storage scan for organization with id $organizationId: $f")
        case _          => logger.error(f"Error during storage scan for organization with id $organizationId: Empty")
      }
    } yield ()

  private def refreshStorageReports(organization: Organization, dataStores: List[DataStore]): Fox[Unit] =
    for {
      storageReportsByDataStore <- Fox.serialCombined(dataStores)(dataStore =>
        refreshStorageReports(dataStore, organization)) ?~> "Failed to fetch used storage reports"
      _ <- organizationDAO.deleteUsedStorage(organization._id) ?~> "Failed to delete outdated used storage entries"
      _ <- Fox.serialCombined(storageReportsByDataStore.zip(dataStores))(storageForDatastore =>
        upsertUsedStorage(organization, storageForDatastore)) ?~> "Failed to upsert used storage reports into db"
      _ <- organizationDAO.updateLastStorageScanTime(organization._id, Instant.now) ?~> "Failed to update last storage scan time in db"
      _ = Thread.sleep(pauseAfterEachOrganization.toMillis)
    } yield ()

  private def refreshStorageReports(dataStore: DataStore,
                                    organization: Organization): Fox[List[DirectoryStorageReport]] = {
    val dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
    dataStoreClient.fetchStorageReport(organization._id, datasetName = None)
  }

  private def upsertUsedStorage(organization: Organization,
                                storageReportsForDatastore: (List[DirectoryStorageReport], DataStore)): Fox[Unit] = {
    val dataStore = storageReportsForDatastore._2
    val storageReports = storageReportsForDatastore._1
    organizationDAO.upsertUsedStorage(organization._id, dataStore.name, storageReports)
  }

  def refreshStorageReportForDataset(dataset: Dataset): Fox[Unit] =
    for {
      dataStore <- datasetService.dataStoreFor(dataset)
      dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
      organization <- organizationDAO.findOne(dataset._organization)
      report <- dataStoreClient.fetchStorageReport(organization._id, Some(dataset.name))
      _ <- organizationDAO.deleteUsedStorageForDataset(dataset._id)
      _ <- organizationDAO.upsertUsedStorage(organization._id, dataStore.name, report)
    } yield ()

}
