package models.storage

import org.apache.pekko.actor.ActorSystem
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.{IntervalScheduler, UPath}
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
  StorageRelevantDataLayerAttachment,
  WKRemoteDataStoreClient
}
import models.organization.{DataLayerAttachmentStorageReport, DatasetMagStorageReport, Organization, OrganizationDAO}
import com.scalableminds.util.tools.{Failure, Full}
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
  private val MaxStoragePathRequestsPerRequest = 200

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
        getNewestStorageReports(dataStore, organization)) ?~> "Failed to fetch used storage reports"
      _ <- organizationDAO.deleteUsedStorage(organization._id) ?~> "Failed to delete outdated used storage entries"
      allMagReports = storageReportsByDataStore.flatMap(reports => reports._1)
      allAttachmentReports = storageReportsByDataStore.flatMap(reports => reports._2)
      _ <- Fox.runIf(allMagReports.nonEmpty || allAttachmentReports.nonEmpty)(
        organizationDAO
          .upsertUsedStorage(allMagReports, allAttachmentReports)) ?~> "Failed to upsert used storage reports into db"
      _ <- organizationDAO.updateLastStorageScanTime(organization._id, Instant.now) ?~> "Failed to update last storage scan time in db"
      _ = Thread.sleep(pauseAfterEachOrganization.toMillis)
    } yield ()

  private def getNewestStorageReports(dataStore: DataStore,
                                      organization: Organization,
                                      datasetIdOpt: Option[ObjectId] = None)
    : Fox[(List[DatasetMagStorageReport], List[DataLayerAttachmentStorageReport])] =
    for {
      relevantMagsForStorageReporting <- datasetMagDAO.findAllStorageRelevantMags(organization._id,
                                                                                  dataStore.name,
                                                                                  datasetIdOpt)
      relevantMagsWithPaths = relevantMagsForStorageReporting.map(resolveMagRowPath)
      relevantMagPaths = relevantMagsWithPaths.flatMap(_._2)
      relevantAttachments <- datasetLayerAttachmentsDAO.findAllStorageRelevantAttachments(organization._id,
                                                                                          dataStore.name,
                                                                                          datasetIdOpt)
      relevantAttachmentsWithResolvedPaths = relevantAttachments.map(resolveAttachmentPath)
      pathToArtifactLookupMap = buildPathToStorageArtifactMap(relevantMagsWithPaths,
                                                              relevantAttachmentsWithResolvedPaths)
      relevantAttachmentPaths = relevantAttachmentsWithResolvedPaths.map(_.path)
      relevantPaths = relevantMagPaths ++ relevantAttachmentPaths
      reports <- fetchAllStorageReportsForPaths(organization._id, relevantPaths, dataStore)
      storageReports = buildStorageReportsForPathReports(organization._id, reports, pathToArtifactLookupMap)
    } yield storageReports

  private def resolveMagRowPath(mag: DataSourceMagRow): (DataSourceMagRow, List[String]) =
    mag.realPath match {
      case Some(realPath) => (mag, List(realPath))
      case None =>
        mag.path match {
          case Some(path) => (mag, List(path))
          case None =>
            val layerPath = Paths.get(mag.directoryName).resolve(mag.dataLayerName)
            (mag,
             List(layerPath.resolve(mag.mag.toMagLiteral(allowScalar = true)).toString,
                  layerPath.resolve(mag.mag.toMagLiteral(allowScalar = false)).toString).distinct)
        }
    }

  private def resolveAttachmentPath(
      attachment: StorageRelevantDataLayerAttachment): StorageRelevantDataLayerAttachment = {
    val upathBox = UPath.fromString(attachment.path)
    upathBox match {
      case Full(upath) if upath.isLocal && upath.isRelative =>
        val datasetPath = Paths.get(attachment.datasetDirectoryName)
        val attachmentPath = datasetPath.resolve(attachment.path).normalize()
        attachment.copy(path = attachmentPath.toString)
      case _ =>
        attachment
    }
  }

  private def buildPathToStorageArtifactMap(
      magsWithValidPaths: List[(DataSourceMagRow, List[String])],
      relevantAttachments: List[StorageRelevantDataLayerAttachment]
  ): Map[String, Either[DataSourceMagRow, StorageRelevantDataLayerAttachment]] = {

    val magEntries: List[(String, Either[DataSourceMagRow, StorageRelevantDataLayerAttachment])] =
      magsWithValidPaths.flatMap {
        case (mag, paths) =>
          paths.map(path => path -> Left(mag))
      }

    val attachmentEntries: List[(String, Either[DataSourceMagRow, StorageRelevantDataLayerAttachment])] =
      relevantAttachments.map(att => att.path -> Right(att))

    (magEntries ++ attachmentEntries).toMap
  }

  private def fetchAllStorageReportsForPaths(organizationId: String,
                                             relevantPaths: List[String],
                                             dataStore: DataStore): Fox[List[PathStorageReport]] = {
    val dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
    for {
      storageReportAnswers <- Fox.serialCombined(relevantPaths.grouped(MaxStoragePathRequestsPerRequest).toList)(
        pathsBatch =>
          dataStoreClient.fetchStorageReports(organizationId, pathsBatch) ?~> "Could not fetch storage report")
      storageReports = storageReportAnswers.flatMap(_.reports)
    } yield storageReports
  }

  private def buildStorageReportsForPathReports(
      organizationId: String,
      pathReports: List[PathStorageReport],
      pathToArtifactMap: Map[String, Either[DataSourceMagRow, StorageRelevantDataLayerAttachment]])
    : (List[DatasetMagStorageReport], List[DataLayerAttachmentStorageReport]) = {
    val reports: List[Either[DatasetMagStorageReport, DataLayerAttachmentStorageReport]] =
      pathReports.flatMap { pathReport =>
        pathToArtifactMap.get(pathReport.path).map {
          case Left(mag) =>
            Left(
              DatasetMagStorageReport(
                mag._dataset,
                mag.dataLayerName,
                mag.mag,
                pathReport.path,
                organizationId,
                pathReport.usedStorageBytes
              ))
          case Right(attachment) =>
            Right(
              DataLayerAttachmentStorageReport(
                attachment._dataset,
                attachment.layerName,
                attachment.name,
                pathReport.path,
                attachment.`type`,
                organizationId,
                pathReport.usedStorageBytes
              ))
        } orElse {
          logger.warn(s"Could not find artifact for path ${pathReport.path} in pathToArtifactMap")
          None
        }
      }
    val magReports = reports.collect { case Left(r)         => r }
    val attachmentReports = reports.collect { case Right(r) => r }
    (magReports, attachmentReports)
  }

  def refreshStorageReportForDataset(dataset: Dataset): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      dataStore <- dataStoreDAO.findOneByName(dataset._dataStore.trim) ?~> "datastore.notFound"
      _ <- if (dataStore.reportUsedStorageEnabled) {
        for {
          organization <- organizationDAO.findOne(dataset._organization)
          reports <- getNewestStorageReports(dataStore, organization, Some(dataset._id))
          _ <- organizationDAO.deleteUsedStorageForDataset(dataset._id)
          _ <- Fox.runIf(reports._1.nonEmpty || reports._2.nonEmpty)(
            organizationDAO
              .upsertUsedStorage(reports._1, reports._2)) ?~> "Failed to upsert used storage reports into db"
        } yield ()
      } else Fox.successful(())
    } yield ()

}
