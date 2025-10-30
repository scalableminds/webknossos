package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.{MagLocator, MappingProvider}
import com.scalableminds.webknossos.datastore.helpers.{DatasetDeleter, IntervalScheduler, UPath}
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools._
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.Json

import java.io.File
import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class DataSourceService @Inject()(
    config: DataStoreConfig,
    dataVaultService: DataVaultService,
    val remoteWebknossosClient: DSRemoteWebknossosClient,
    val lifecycle: ApplicationLifecycle,
    @Named("webknossos-datastore") val actorSystem: ActorSystem
)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with DatasetDeleter
    with LazyLogging
    with DataSourceToDiskWriter
    with FoxImplicits
    with DataSourceValidation
    with Formatter {

  override protected def tickerEnabled: Boolean = config.Datastore.WatchFileSystem.enabled
  override protected def tickerInterval: FiniteDuration = config.Datastore.WatchFileSystem.interval

  override protected def tickerInitialDelay: FiniteDuration = config.Datastore.WatchFileSystem.initialDelay

  val dataBaseDir: Path = config.Datastore.baseDirectory

  private val propertiesFileName = Path.of(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)

  private var inboxCheckVerboseCounter = 0

  def tick(): Fox[Unit] =
    for {
      _ <- checkInbox(verbose = inboxCheckVerboseCounter == 0, organizationId = None)
      _ = inboxCheckVerboseCounter += 1
      _ = if (inboxCheckVerboseCounter >= 10) inboxCheckVerboseCounter = 0
    } yield ()

  def assertDataDirWritable(organizationId: String): Fox[Unit] = {
    val orgaPath = dataBaseDir.resolve(organizationId)
    if (orgaPath.toFile.exists()) {
      Fox.fromBool(Files.isWritable(dataBaseDir.resolve(organizationId))) ?~> "Datastore cannot write to organization data directory."
    } else {
      tryo {
        Files.createDirectory(orgaPath)
      }.map(_ => ()).toFox ?~> "Could not create organization directory on datastore server"
    }
  }

  def checkInbox(verbose: Boolean, organizationId: Option[String]): Fox[Unit] = {
    val before = Instant.now
    val selectedOrgaLabel = organizationId.map(id => s"/$id").getOrElse("")
    def orgaFilterFn(organizationId: String): Path => Boolean =
      (path: Path) => path.getFileName.toString == organizationId
    val selectedOrgaFilter: Path => Boolean = organizationId.map(id => orgaFilterFn(id)).getOrElse((_: Path) => true)
    if (verbose) logger.info(s"Scanning inbox ($dataBaseDir$selectedOrgaLabel)...")
    for {
      _ <- PathUtils.listDirectories(dataBaseDir, silent = false, filters = selectedOrgaFilter) match {
        case Full(organizationDirs) =>
          if (verbose && organizationId.isEmpty) logEmptyDirs(organizationDirs)
          val foundDataSources = organizationDirs.flatMap(scanOrganizationDirForDataSources)
          val (realPathInfos, realPathScanFailures) = scanRealPaths(foundDataSources)
          for {
            _ <- remoteWebknossosClient.reportDataSources(foundDataSources, organizationId)
            _ <- remoteWebknossosClient.reportRealPaths(realPathInfos)
            _ = logFoundDatasources(before,
                                    verbose,
                                    selectedOrgaLabel,
                                    foundDataSources,
                                    realPathInfos,
                                    realPathScanFailures)
          } yield ()
        case e =>
          val errorMsg = s"Failed to scan inbox. Error during list directories on '$dataBaseDir$selectedOrgaLabel': $e"
          logger.error(errorMsg)
          Fox.failure(errorMsg)
      }
    } yield ()
  }

  private def scanRealPaths(dataSources: List[DataSource]): (Seq[DataSourcePathInfo], Seq[Failure]) = {
    val withFailures = dataSources.map(scanRealPathsForDataSource)
    val pathInfos = withFailures.map(_._1).filter(_.nonEmpty)
    val failures = withFailures.flatMap(_._2)
    (pathInfos, failures)
  }

  private def scanRealPathsForDataSource(dataSource: DataSource): (DataSourcePathInfo, Seq[Failure]) = {
    val datasetPath = dataBaseDir.resolve(dataSource.id.organizationId).resolve(dataSource.id.directoryName)
    dataSource.toUsable match {
      case Some(usableDataSource) =>
        val magResultBoxes = usableDataSource.dataLayers.flatMap { dataLayer =>
          dataLayer.mags.map(mag => getMagPathInfo(datasetPath, dataLayer.name, mag))
        }
        val attachmentResultBoxes = usableDataSource.dataLayers.flatMap { dataLayer =>
          dataLayer.attachments
            .map(_.allAttachments)
            .getOrElse(Seq.empty)
            .map(attachment => getAttachmentPathInfo(datasetPath, attachment))
        }
        val failures = (magResultBoxes ++ attachmentResultBoxes).flatMap {
          case f: Failure => Some(f)
          case _          => None
        }
        (DataSourcePathInfo(dataSource.id, magResultBoxes.flatten, attachmentResultBoxes.flatten), failures)
      case None => (DataSourcePathInfo(dataSource.id, Seq.empty, Seq.empty), Seq.empty)
    }
  }

  private def getMagPathInfo(datasetPath: Path, layerName: String, mag: MagLocator): Box[RealPathInfo] = {
    val resolvedMagPath = dataVaultService.resolveMagPath(
      mag,
      datasetPath,
      datasetPath.resolve(layerName)
    )
    if (resolvedMagPath.isRemote) {
      Full(RealPathInfo(resolvedMagPath, resolvedMagPath, hasLocalData = false))
    } else {
      for {
        magPath <- resolvedMagPath.toLocalPath
        realMagPath <- tryo(magPath.toRealPath())
        // Does this dataset have local data, i.e. the data that is referenced by the mag path is within the dataset directory
        isDatasetLocal = realMagPath.startsWith(datasetPath.toAbsolutePath)
      } yield RealPathInfo(resolvedMagPath, UPath.fromLocalPath(realMagPath), hasLocalData = isDatasetLocal)
    }
  }

  private def getAttachmentPathInfo(datasetPath: Path, attachment: LayerAttachment): Box[RealPathInfo] =
    // TODO is attachmentPath always absolute?
    if (attachment.path.isRemote) {
      Full(RealPathInfo(attachment.path, attachment.path, hasLocalData = false))
    } else {
      for {
        attachmentPath <- attachment.path.toLocalPath
        realAttachmentPath <- tryo(attachmentPath.toRealPath())
        // Does this dataset have local data, i.e. the data that is referenced by the mag path is within the dataset directory
        isDatasetLocal = realAttachmentPath.startsWith(datasetPath.toAbsolutePath)
      } yield RealPathInfo(attachment.path, UPath.fromLocalPath(realAttachmentPath), hasLocalData = isDatasetLocal)
    }

  private def logFoundDatasources(before: Instant,
                                  verbose: Boolean,
                                  selectedOrgaLabel: String,
                                  foundDataSources: Seq[DataSource],
                                  realPathInfosByDataSource: Seq[DataSourcePathInfo],
                                  realPathScanFailures: Seq[Failure]): Unit = {
    val numScannedRealPaths = realPathInfosByDataSource
      .map(pathInfos => pathInfos.attachmentPathInfos.length + pathInfos.magPathInfos.length)
      .sum
    val realPathFailuresSummary =
      if (realPathScanFailures.isEmpty) "" else s" ${realPathScanFailures.length} realPath scan failures"
    val realPathScanSummary = s"$numScannedRealPaths scanned realpaths.$realPathFailuresSummary"
    val shortForm =
      s"Finished scanning inbox ($dataBaseDir$selectedOrgaLabel), took ${formatDuration(Instant.since(before))}: ${foundDataSources
        .count(_.isUsable)} active, ${foundDataSources.count(!_.isUsable)} inactive. $realPathScanSummary"
    val msg = if (verbose) {
      val byTeam: Map[String, Seq[DataSource]] = foundDataSources.groupBy(_.id.organizationId)
      shortForm + ". " + byTeam.keys.map { team =>
        val byUsable: Map[Boolean, Seq[DataSource]] = byTeam(team).groupBy(_.isUsable)
        team + ": [" + byUsable.keys.map { usable =>
          val label = if (usable) "active: [" else "inactive: ["
          label + byUsable(usable).map { ds =>
            s"${ds.id.directoryName}"
          }.mkString(" ") + "]"
        }.mkString(", ") + "]"
      }.mkString(", ")
    } else {
      shortForm
    }
    logger.info(msg)
    if (verbose && realPathScanFailures.nonEmpty) {
      val realPathScanFailuresFormatted = realPathScanFailures.flatMap(_.exception).map(_.toString).mkString(", ")
      logger.warn(s"RealPath scan failures: $realPathScanFailuresFormatted")
    }
  }

  private def logEmptyDirs(paths: List[Path]): Unit = {

    val emptyDirs = paths.flatMap { path =>
      PathUtils.listDirectories(path, silent = true) match {
        case Full(Nil) =>
          Some(path)
        case _ => None
      }
    }

    if (emptyDirs.nonEmpty) {
      val limit = 5
      val moreLabel = if (emptyDirs.length > limit) s", ... (${emptyDirs.length} total)" else ""
      logger.warn(s"Empty organization dataset dirs: ${emptyDirs.take(limit).mkString(", ")}$moreLabel")
    }
  }

  def exploreMappings(organizationId: String, datasetDirectoryName: String, dataLayerName: String): Set[String] =
    MappingProvider
      .exploreMappings(dataBaseDir.resolve(organizationId).resolve(datasetDirectoryName).resolve(dataLayerName))
      .getOrElse(Set())

  private def scanOrganizationDirForDataSources(path: Path): List[DataSource] = {
    val organization = path.getFileName.toString

    PathUtils.listDirectories(path, silent = true) match {
      case Full(dataSourceDirs) =>
        val dataSources = dataSourceDirs.map(path => dataSourceFromDir(path, organization))
        dataSources
      case _ =>
        logger.error(s"Failed to list directories for organization $organization at path $path")
        Nil
    }
  }

  def dataSourceFromDir(path: Path, organizationId: String): DataSource = {
    val id = DataSourceId(path.getFileName.toString, organizationId)
    val propertiesFile = path.resolve(propertiesFileName)

    if (new File(propertiesFile.toString).exists()) {
      JsonHelper.parseFromFileAs[UsableDataSource](propertiesFile, path) match {
        case Full(dataSource) =>
          val validationErrors = validateDataSourceGetErrors(dataSource)
          if (validationErrors.isEmpty) {
            val dataSourceWithAttachments = dataSource.copy(
              dataLayers = resolveAttachmentsAndAddScanned(path, dataSource)
            )
            val dataSourceWithMagPaths = dataSourceWithAttachments.copy(
              dataLayers = addMagPaths(path, dataSourceWithAttachments)
            )
            dataSourceWithMagPaths.copy(id)
          } else
            UnusableDataSource(id,
                               None,
                               s"Error: ${validationErrors.mkString(" ")}",
                               Some(dataSource.scale),
                               Some(Json.toJson(dataSource)))
        case e =>
          UnusableDataSource(id,
                             None,
                             s"Error: Invalid json format in $propertiesFile: $e",
                             existingDataSourceProperties = JsonHelper.parseFromFile(propertiesFile, path).toOption)
      }
    } else {
      UnusableDataSource(id, None, DataSourceStatus.notImportedYet)
    }
  }

  private def addMagPaths(dataSourcePath: Path, dataSource: UsableDataSource): List[StaticLayer] =
    dataSource.dataLayers.map { dataLayer =>
      dataLayer.mapped(
        newMags = Some(dataLayer.mags.map { magLocator =>
          magLocator.copy(
            path =
              Some(dataVaultService.resolveMagPath(magLocator, dataSourcePath, dataSourcePath.resolve(dataLayer.name))))
        })
      )
    }

  def resolvePathsInNewBasePath(dataSource: UsableDataSource, newBasePath: UPath): UsableDataSource = {
    val updatedDataLayers = dataSource.dataLayers.map { layer =>
      layer.mapped(
        magMapping = mag =>
          mag.path match {
            case Some(existingMagPath) => mag.copy(path = Some(existingMagPath.resolvedIn(newBasePath)))
            // If the mag does not have a path, it is an implicit path, we need to make it explicit.
            case _ =>
              mag.copy(
                path = Some(newBasePath / layer.name / mag.mag.toMagLiteral(true))
              )
        },
        attachmentMapping = _.resolvedIn(newBasePath)
      )
    }
    dataSource.copy(dataLayers = updatedDataLayers)
  }

  private def resolveAttachmentsAndAddScanned(dataSourcePath: Path, dataSource: UsableDataSource) =
    dataSource.dataLayers.map(dataLayer => {
      val dataLayerPath = dataSourcePath.resolve(dataLayer.name)
      dataLayer.withMergedAndResolvedAttachments(
        UPath.fromLocalPath(dataSourcePath),
        DataLayerAttachments(
          MeshFileInfo.scanForMeshFiles(dataLayerPath),
          AgglomerateFileInfo.scanForAgglomerateFiles(dataLayerPath),
          SegmentIndexFileInfo.scanForSegmentIndexFile(dataLayerPath),
          ConnectomeFileInfo.scanForConnectomeFiles(dataLayerPath),
          CumsumFileInfo.scanForCumsumFile(dataLayerPath)
        )
      )
    })

  def invalidateVaultCache(dataSource: DataSource, dataLayerName: Option[String]): Option[Int] =
    for {
      usableDataSource <- dataSource.toUsable
      dataLayers = dataLayerName match {
        case Some(ln) => Seq(usableDataSource.getDataLayer(ln))
        case None     => usableDataSource.dataLayers.map(d => Some(d))
      }
      removedEntriesList = for {
        dataLayerOpt <- dataLayers
        dataLayer <- dataLayerOpt
        _ = dataLayer.mags.foreach(mag => dataVaultService.removeVaultFromCache(mag, dataSource.id, dataLayer.name))
        _ = dataLayer.attachments.foreach(_.allAttachments.foreach(attachment =>
          dataVaultService.removeVaultFromCache(attachment)))
      } yield dataLayer.mags.length
    } yield removedEntriesList.sum

}
