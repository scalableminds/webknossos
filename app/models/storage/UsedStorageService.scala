package models.storage

import org.apache.pekko.actor.ActorSystem
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.PathStorageReport
import com.typesafe.scalalogging.LazyLogging
import models.dataset.{
  DataSourceMagRow,
  DataStore,
  DataStoreDAO,
  Dataset,
  DatasetLayerAttachmentsDAO,
  DatasetMagsDAO,
  DatasetService,
  WKRemoteDataStoreClient
}
import models.organization.{ArtifactStorageReport, Organization, OrganizationDAO}
import com.scalableminds.util.tools.{Failure, Full}
import com.scalableminds.webknossos.schema.Tables.DatasetLayerAttachmentsRow
import play.api.inject.ApplicationLifecycle
import utils.WkConf
import utils.sql.SqlEscaping

import java.nio.file.Paths
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class UsedStorageService @Inject()(val actorSystem: ActorSystem,
                                   val lifecycle: ApplicationLifecycle,
                                   organizationDAO: OrganizationDAO,
                                   datasetService: DatasetService,
                                   dataStoreDAO: DataStoreDAO,
                                   datasetMagDAO: DatasetMagsDAO,
                                   datasetLayerAttachmentsDAO: DatasetLayerAttachmentsDAO,
                                   rpc: RPC,
                                   config: WkConf)(implicit val ec: ExecutionContext)
    extends LazyLogging
    with IntervalScheduler
    with SqlEscaping {

  /* Note that not every tick here will scan something, there is additional logic below:
     Every tick, et most scansPerTick organizations are scanned.
     But only if their last full scan is was sufficiently long ago
     The organizations with the most outdated scan are selected each tick. This is to distribute the load.
   */
  override protected def tickerInterval: FiniteDuration = config.WebKnossos.FetchUsedStorage.tickerInterval
  override protected def tickerInitialDelay: FiniteDuration = 1 minute

  private val pauseAfterEachOrganization = 5 seconds
  private val organizationCountToScanPerTick = config.WebKnossos.FetchUsedStorage.scansPerTick
  private val MAX_STORAGE_PATH_REQUESTS_PER_REQUEST = 200

  implicit private val ctx: DBAccessContext = GlobalAccessContext

  override protected def tick(): Fox[Unit] =
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
      box <- result.shiftBox
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
      allStorageReports = storageReportsByDataStore.flatten
      _ <- Fox.runIfNonEmpty(allStorageReports)(organizationDAO.upsertUsedStorage(organization._id, allStorageReports)) ?~> "Failed to upsert used storage reports into db"
      _ <- organizationDAO.updateLastStorageScanTime(organization._id, Instant.now) ?~> "Failed to update last storage scan time in db"
      _ = Thread.sleep(pauseAfterEachOrganization.toMillis)
    } yield ()

  private def refreshStorageReports(dataStore: DataStore,
                                    organization: Organization): Fox[List[ArtifactStorageReport]] =
    for {
      relevantMagsForStorageReporting <- datasetMagDAO.findAllStorageRelevantMags(organization._id, dataStore.name)
      relevantPathsAndUnparsableMags = relevantMagsForStorageReporting.map(resolvePath)
      unparsableMags = relevantPathsAndUnparsableMags.collect { case Right(mag) => mag }.distinctBy(_._dataset)
      relevantMagsWithValidPaths = relevantPathsAndUnparsableMags.collect { case Left(magWithPaths) => magWithPaths }
      relevantMagPaths = relevantPathsAndUnparsableMags.collect { case Left((_, paths)) => paths }.flatten
      _ = Fox.runIfNonEmpty(unparsableMags)(logger.error(
        s"Found dataset mags with unparsable mag literals in datastore ${dataStore.name} of organization ${organization._id} with dataset ids : ${unparsableMags
          .map(_._dataset)}"))
      relevantAttachments <- datasetLayerAttachmentsDAO.findAllStorageRelevantAttachments(organization._id,
                                                                                          dataStore.name)
      pathToArtifactLookupMap = buildPathToStorageArtifactMap(relevantMagsWithValidPaths, relevantAttachments)
      relevantAttachmentPaths = relevantAttachments.map(_.path)
      relevantPaths = relevantMagPaths ++ relevantAttachmentPaths
      // TODO: Paginate! Max 200 per request or so.
      reports <- fetchAllStorageReportsForPaths(organization._id, relevantPaths, dataStore)
      storageReports = buildStorageReportsForPathReports(organization._id, reports, pathToArtifactLookupMap)
    } yield storageReports

  private def resolvePath(mag: DataSourceMagRow): Either[(DataSourceMagRow, List[String]), DataSourceMagRow] =
    mag match {
      case mag.realPath if mag.realPath.isDefined => Left(mag, List(mag.realPath.get))
      case mag.path if mag.path.isDefined         => Left(mag, List(mag.path.get))
      case _ =>
        val layerPath = Paths.get(mag.directoryName).resolve(mag.dataLayerName)
        val parsedMagOpt = Vec3Int.fromList(parseArrayLiteral(mag.mag).map(_.toInt))
        parsedMagOpt match {
          case Some(parsedMag) =>
            Left(
              // TODOM: Discuss whether this should be done here or maybe on the datastore side
              // - pro datastore side: separation of concerns
              // - pro wk core: easier to implement, no need to send whole mag object to datastore
              mag,
              List(layerPath.resolve(parsedMag.toMagLiteral(allowScalar = true)).toString,
                   layerPath.resolve(parsedMag.toMagLiteral(allowScalar = false)).toString)
            )
          case None => Right(mag)
        }
    }

  private def buildPathToStorageArtifactMap(
      magsWithValidPaths: List[(DataSourceMagRow, List[String])],
      relevantAttachments: List[DatasetLayerAttachmentsRow]
  ): Map[String, Either[DataSourceMagRow, DatasetLayerAttachmentsRow]] = {

    val magEntries: List[(String, Either[DataSourceMagRow, DatasetLayerAttachmentsRow])] =
      magsWithValidPaths.flatMap {
        case (mag, paths) =>
          paths.map(path => path -> Left(mag))
      }

    val attachmentEntries: List[(String, Either[DataSourceMagRow, DatasetLayerAttachmentsRow])] =
      relevantAttachments.map(att => att.path -> Right(att))

    (magEntries ++ attachmentEntries).toMap
  }

  private def fetchAllStorageReportsForPaths(organizationId: String,
                                             relevantPaths: List[String],
                                             dataStore: DataStore): Fox[List[PathStorageReport]] = {
    val dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
    for {
      storageReportAnswers <- Fox.serialCombined(relevantPaths.grouped(MAX_STORAGE_PATH_REQUESTS_PER_REQUEST).toList)(
        pathsBatch =>
          dataStoreClient.fetchStorageReports(organizationId, pathsBatch) ?~> "Could not fetch storage report")
      storageReports = storageReportAnswers.flatMap(_.reports)
    } yield storageReports
  }

  private def buildStorageReportsForPathReports(
      organizationId: String,
      pathReports: List[PathStorageReport],
      pathToArtifactMap: Map[String, Either[DataSourceMagRow, DatasetLayerAttachmentsRow]])
    : List[ArtifactStorageReport] =
    pathReports.flatMap(pathReport => {
      pathToArtifactMap(pathReport.path) match {
        case Left(mag) =>
          Some(
            ArtifactStorageReport(organizationId,
                                  mag._dataset,
                                  Left(mag._id),
                                  pathReport.path,
                                  pathReport.usedStorageBytes))
        case Right(attachment) =>
          val attachmentId = ObjectId.fromStringSync(attachment._Id)
          attachmentId.flatMap(
            id =>
              Some(
                ArtifactStorageReport(organizationId,
                                      ObjectId(attachment._Dataset),
                                      Right(id),
                                      pathReport.path,
                                      pathReport.usedStorageBytes)))

      }
    })

  // TODOM!
  def refreshStorageReportForDataset(dataset: Dataset): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      /* dataStore <- datasetService.dataStoreFor(dataset)
      _ <- if (dataStore.reportUsedStorageEnabled) {
        val dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
        for {
          organization <- organizationDAO.findOne(dataset._organization)
          report <- dataStoreClient.fetchStorageReport(organization._id, Some(dataset.name))
          _ <- organizationDAO.deleteUsedStorageForDataset(dataset._id)
          _ <- organizationDAO.upsertUsedStorage(organization._id, dataStore.name, report)
        } yield ()
      } else Fox.successful(())*/
    } yield ()

}
