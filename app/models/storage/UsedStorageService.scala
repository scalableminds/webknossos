package models.storage

import akka.actor.ActorSystem
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.DirectoryStorageReport
import com.typesafe.scalalogging.LazyLogging
import models.binary.{DataStore, DataStoreDAO, WKRemoteDataStoreClient}
import models.organization.{Organization, OrganizationDAO}
import play.api.inject.ApplicationLifecycle
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class UsedStorageService @Inject()(val system: ActorSystem,
                                   val lifecycle: ApplicationLifecycle,
                                   organizationDAO: OrganizationDAO,
                                   dataStoreDAO: DataStoreDAO,
                                   rpc: RPC,
                                   config: WkConf)(implicit ec: ExecutionContext)
    extends LazyLogging
    with IntervalScheduler {

  override protected def tickerInterval: FiniteDuration = 3 seconds

  implicit private val accessContext: DBAccessContext = GlobalAccessContext

  private val isRunning = new java.util.concurrent.atomic.AtomicBoolean(false)

  private val pauseAfterEachOrganization = (5 seconds).toMillis

  override protected def tick(): Unit =
    if (isRunning.compareAndSet(false, true)) {
      tickAsync().futureBox.onComplete { _ =>
        isRunning.set(false)
      }
    }

  private def tickAsync(): Fox[Unit] =
    for {
      organizations <- organizationDAO.findNotRecentlyScanned(5 minutes)
      dataStores <- dataStoreDAO.findAllWithStorageReporting
      _ = logger.info(s"Scanning ${organizations.length} organizations in ${dataStores.length} datastores...")
      _ <- Fox.serialCombined(organizations)(organization => fetchStorageReport(organization, dataStores))
    } yield ()

  private def fetchStorageReport(organization: Organization, dataStores: List[DataStore]): Fox[Unit] =
    for {
      storageReportsByDataStore <- Fox.serialCombined(dataStores)(dataStore =>
        fetchStorageReport(dataStore, organization))
      _ <- organizationDAO.deleteUsedStorage(organization._id)
      _ <- Fox.serialCombined(storageReportsByDataStore.zip(dataStores))(storageForDatastore =>
        upsertUsedStorage(organization, storageForDatastore))
      // TODO _ <- organizationDAO.updateUsedStorageScan
      _ = Thread.sleep(pauseAfterEachOrganization)
    } yield ()

  private def fetchStorageReport(dataStore: DataStore,
                                 organization: Organization): Fox[List[DirectoryStorageReport]] = {
    val dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
    dataStoreClient.fetchStorageReport(organization.name)
  }

  private def upsertUsedStorage(organization: Organization,
                                storageReportsForDatastore: (List[DirectoryStorageReport], DataStore)): Fox[Unit] = {
    val dataStore = storageReportsForDatastore._2
    val storageReports = storageReportsForDatastore._1
    organizationDAO.upsertUsedStorage(organization._id, dataStore.name, storageReports)
  }

}
