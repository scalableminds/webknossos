package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.Msg
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.helpers.{IntervalScheduler, UPath}
import com.scalableminds.webknossos.datastore.models.datasource.*
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.*
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.Json

import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.*

class DataSourceService @Inject() (
    config: DataStoreConfig,
    dataVaultService: DataVaultService,
    baseDirService: BaseDirService,
    val remoteWebknossosClient: DSRemoteWebknossosClient,
    val lifecycle: ApplicationLifecycle,
    @Named("webknossos-datastore") val actorSystem: ActorSystem
)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with LazyLogging
    with DataSourceToDiskWriter
    with DataSourceValidation
    with Formatter {

  override protected def tickerEnabled: Boolean = config.Datastore.WatchFileSystem.enabled
  override protected def tickerInterval: FiniteDuration = config.Datastore.WatchFileSystem.interval
  override protected def tickerInitialDelay: FiniteDuration = config.Datastore.WatchFileSystem.initialDelay

  private val propertiesFileName = Path.of(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)

  private var scanBaseDirsVerboseCounter = 0

  def tick(): Fox[Unit] =
    for {
      _ <- scanBaseDirectories(verbose = scanBaseDirsVerboseCounter == 0, organizationId = None)
      _ = scanBaseDirsVerboseCounter += 1
      _ = if (scanBaseDirsVerboseCounter >= 10) scanBaseDirsVerboseCounter = 0
    } yield ()

  def scanBaseDirectories(verbose: Boolean, organizationId: Option[String]): Fox[Unit] = for {
    resultBox <- scanBaseDirectoriesImpl(verbose, organizationId).shiftBox
    res <- resultBox match {
      case f: Failure =>
        logger.error(f"Error while scanning base directories: ${formatFailureChain(f, includeStackTraces = true)}")
        f.toFox
      case _ => resultBox.toFox
    }
  } yield res

  private def scanBaseDirectoriesImpl(verbose: Boolean, organizationId: Option[String]): Fox[Unit] = {
    val before = Instant.now
    for {
      allOrgaDirsWithIds: Seq[(Path, String)] <- orgaDirsToScan(
        organizationId
      ).toFox ?~> Msg.DataStore.getBaseDirsToScanFailed
      allOrgaDirsFormatted = allOrgaDirsWithIds.map(_._1).mkString(", ")
      _ = if (verbose) logger.info(s"Scanning base directories ($allOrgaDirsFormatted)...")
      _ = if (verbose && organizationId.isEmpty) logEmptyDirs(allOrgaDirsWithIds.map(_._1))
      foundDataSourcesWithPathInfoRaw = allOrgaDirsWithIds.flatMap(scanOrganizationDirForDataSources)
      foundDataSourcesWithPathInfoDeduplicated = deduplicateByDataSourceId(foundDataSourcesWithPathInfoRaw, verbose)
      foundDataSources = foundDataSourcesWithPathInfoDeduplicated.map(_.dataSource)
      (realPathInfos, realPathScanFailures) = scanRealPaths(foundDataSourcesWithPathInfoDeduplicated)
      _ <- remoteWebknossosClient.reportDataSources(foundDataSourcesWithPathInfoDeduplicated, organizationId)
      _ <- remoteWebknossosClient.reportRealPaths(realPathInfos)
      _ = logFoundDatasources(
        allOrgaDirsFormatted,
        before,
        verbose,
        foundDataSources,
        realPathInfos,
        realPathScanFailures
      )
    } yield ()
  }

  private def orgaDirsToScan(selectedOrganizationIdOpt: Option[String]): Box[Seq[(Path, String)]] = {
    val orgaAgnosticBaseDirs = baseDirService.allOrgaAgnosticLocalBaseDirs(requireDoScan = true)
    selectedOrganizationIdOpt match {
      case Some(selectedOrganizationId) =>
        def orgaFilterFn(organizationId: String): Path => Boolean =
          (path: Path) => path.getFileName.toString == organizationId
        val orgaBaseDirsDirect = baseDirService.allLocalBaseDirsForOrga(selectedOrganizationId, requireDoScan = true)
        for {
          orgaDirsInAgnostic: Seq[Path] <- orgaAgnosticBaseDirs
            .map(PathUtils.listDirectories(_, silent = false, filters = orgaFilterFn(selectedOrganizationId)))
            .toList
            .toSingleBox("Listdir failed")
            .map(_.flatten)
        } yield (orgaBaseDirsDirect ++ orgaDirsInAgnostic).map((_, selectedOrganizationId))
      case None =>
        def orgaIdFromOrgaDirPath(path: Path) = path.getFileName.toString
        val orgaBaseDirsDirectWithIds = baseDirService.allOrgaSpecificLocalBaseDirs(requireDoScan = true)
        for {
          orgaDirsInAgnostic: Seq[Path] <- orgaAgnosticBaseDirs
            .map(PathUtils.listDirectories(_, silent = false))
            .toList
            .toSingleBox("Listdir failed")
            .map(_.flatten)
          orgaDirsInAgnosticWithIds = orgaDirsInAgnostic.map(orgaDir => (orgaDir, orgaIdFromOrgaDirPath(orgaDir)))
        } yield orgaBaseDirsDirectWithIds ++ orgaDirsInAgnosticWithIds
    }
  }

  def scanRealPathsForVirtual(dataSources: Seq[DataSourceWithRootPathInfo]): Fox[Unit] =
    for {
      before <- Instant.nowFox
      (realPathInfos, realPathScanFailures) = scanRealPaths(dataSources)
      _ <- remoteWebknossosClient.reportRealPaths(realPathInfos)
      realPathFailuresSummary =
        if (realPathScanFailures.isEmpty) ""
        else s". ${realPathScanFailures.length} realPath scan failures"
      _ = Instant.logSince(
        before,
        s"Scanned ${countScannedRealPaths(realPathInfos)} realpaths for ${dataSources.length} virtual datasets$realPathFailuresSummary."
      )
      _ = logRealPathScanFailures(verbose = true, realPathScanFailures)
    } yield ()

  private def logRealPathScanFailures(verbose: Boolean, realPathScanFailures: Seq[Failure]): Unit =
    if (verbose && realPathScanFailures.nonEmpty) {
      val realPathScanFailuresFormatted = realPathScanFailures.flatMap(_.exception).map(_.toString).mkString(", ")
      logger.warn(s"RealPath scan failures: $realPathScanFailuresFormatted")
    }

  private def scanRealPaths(dataSources: Seq[DataSourceWithRootPathInfo]): (Seq[DataSourcePathInfo], Seq[Failure]) = {
    val withFailures = dataSources.map(scanRealPathsForDataSource)
    val pathInfos = withFailures.map(_._1).filter(_.nonEmpty)
    val failures = withFailures.flatMap(_._2)
    (pathInfos, failures)
  }

  private def scanRealPathsForDataSource(
      dataSourceWithRootPathInfo: DataSourceWithRootPathInfo
  ): (DataSourcePathInfo, Seq[Failure]) = {
    val datasetPath: Option[Path] =
      dataSourceWithRootPathInfo.rootRealPath.orElse(dataSourceWithRootPathInfo.rootPath).map(Path.of(_))
    val dataSource = dataSourceWithRootPathInfo.dataSource
    dataSource.toUsable match {
      case Some(usableDataSource) =>
        val magResultBoxes = usableDataSource.dataLayers.flatMap { dataLayer =>
          dataLayer.mags.map(mag => getMagPathInfo(datasetPath, mag))
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

  private def getMagPathInfo(datasetPathOpt: Option[Path], mag: MagLocator): Box[RealPathInfo] =
    for {
      magPath <- Box(mag.path)
      result <-
        if (magPath.isRemote) {
          Full(RealPathInfo(magPath, magPath, hasLocalData = false))
        } else {
          for {
            magPathLocal <- magPath.toLocalPath
            realMagPath <- tryo(magPathLocal.toRealPath())
            // Does this dataset have local data, i.e. the data that is referenced by the mag path is within the dataset directory
            isDatasetLocal = datasetPathOpt.exists(datasetPath => realMagPath.startsWith(datasetPath))
          } yield RealPathInfo(magPath, UPath.fromLocalPath(realMagPath), hasLocalData = isDatasetLocal)
        }
    } yield result

  private def getAttachmentPathInfo(datasetPathOpt: Option[Path], attachment: LayerAttachment): Box[RealPathInfo] =
    if (attachment.path.isRemote) {
      Full(RealPathInfo(attachment.path, attachment.path, hasLocalData = false))
    } else {
      for {
        _ <- Box.fromBool(attachment.path.isAbsolute) ?~ "Attachment path as stored in db must be absolute"
        attachmentPath <- attachment.path.toLocalPath
        realAttachmentPath <- tryo(attachmentPath.toRealPath())
        // Does this dataset have local data, i.e. the data that is referenced by the mag path is within the dataset directory
        isDatasetLocal = datasetPathOpt.exists(datasetPath => realAttachmentPath.startsWith(datasetPath))
      } yield RealPathInfo(attachment.path, UPath.fromLocalPath(realAttachmentPath), hasLocalData = isDatasetLocal)
    }

  private def logFoundDatasources(
      allOrgaDirsFormatted: String,
      before: Instant,
      verbose: Boolean,
      foundDataSources: Seq[DataSource],
      realPathInfosByDataSource: Seq[DataSourcePathInfo],
      realPathScanFailures: Seq[Failure]
  ): Unit = {
    val realPathFailuresSummary =
      if (realPathScanFailures.isEmpty) "" else s" ${realPathScanFailures.length} realPath scan failures"
    val realPathScanSummary =
      s"${countScannedRealPaths(realPathInfosByDataSource)} scanned realpaths.$realPathFailuresSummary"
    val shortForm =
      s"Finished scanning base directories ($allOrgaDirsFormatted), took ${formatDuration(Instant.since(before))}: ${foundDataSources
          .count(_.isUsable)} active, ${foundDataSources.count(!_.isUsable)} inactive. $realPathScanSummary"
    val msg = if (verbose) {
      val byOrganization: Map[String, Seq[DataSource]] = foundDataSources.groupBy(_.id.organizationId)
      shortForm + ". " + byOrganization.keys.map { team =>
        val byUsable: Map[Boolean, Seq[DataSource]] = byOrganization(team).groupBy(_.isUsable)
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
    logRealPathScanFailures(verbose, realPathScanFailures)
  }

  private def countScannedRealPaths(realPathInfosByDataSource: Seq[DataSourcePathInfo]): Int =
    realPathInfosByDataSource.map(pathInfos => pathInfos.attachmentPathInfos.length + pathInfos.magPathInfos.length).sum

  private def logEmptyDirs(paths: Seq[Path]): Unit = {

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

  private def deduplicateByDataSourceId(
      dataSourcesWithPathInfo: Seq[DataSourceWithRootPathInfo],
      verbose: Boolean
  ): Seq[DataSourceWithRootPathInfo] = {
    if (verbose) {
      dataSourcesWithPathInfo.groupBy(_.dataSource.id).foreach {
        case (dataSourceId, dataSources) if dataSources.length > 1 =>
          val rootPaths = dataSources.flatMap(_.rootPath).mkString(", ")
          logger.warn(
            s"Found ${dataSources.length} datasets with conflicting id $dataSourceId at root paths: $rootPaths. " +
              s"Using the first one and ignoring the others."
          )
        case _ => ()
      }
    }
    dataSourcesWithPathInfo.distinctBy(_.dataSource.id)
  }

  private def scanOrganizationDirForDataSources(orgaDirWithId: (Path, String)): Seq[DataSourceWithRootPathInfo] = {
    val (path, organizationId) = orgaDirWithId

    PathUtils.listDirectories(path, silent = true) match {
      case Full(dataSourceDirs) =>
        dataSourceDirs.map { dirPath =>
          val realPath = tryo(dirPath.toRealPath()).getOrElse(dirPath)
          DataSourceWithRootPathInfo(
            dataSourceFromDir(dirPath, organizationId, resolvePaths = true),
            Some(dirPath.toString),
            Some(realPath.toString)
          )
        }
      case _ =>
        logger.error(s"Failed to list directories for organization $organizationId at path $path")
        Seq.empty
    }
  }

  def dataSourceFromDir(path: Path, organizationId: String, resolvePaths: Boolean): DataSource = {
    val id = DataSourceId(path.getFileName.toString, organizationId)
    val propertiesFilePath = path.resolve(propertiesFileName)

    if (Files.exists(propertiesFilePath)) {
      JsonHelper.parseFromFileAs[UsableDataSource](propertiesFilePath, path) match {
        case Full(dataSource) =>
          val validationErrors = validateDataSourceGetErrors(dataSource)
          if (validationErrors.isEmpty) {
            val dataSourceWithAttachments = dataSource.copy(
              dataLayers = addScannedAttachments(path, dataSource)
            )
            val dataSourceWithResolvedPaths =
              if (resolvePaths)
                dataSourceWithAttachments.copy(
                  dataLayers = resolveDataSourcePaths(path, dataSourceWithAttachments)
                )
              else dataSourceWithAttachments
            dataSourceWithResolvedPaths.copy(id)
          } else
            UnusableDataSource(
              id,
              None,
              s"Error: ${validationErrors.mkString(" ")}",
              Some(dataSource.scale),
              Some(Json.toJson(dataSource))
            )
        case e =>
          UnusableDataSource(
            id,
            None,
            s"Error: Invalid json format in $propertiesFilePath: $e",
            existingDataSourceProperties = JsonHelper.parseFromFile(propertiesFilePath, path).toOption
          )
      }
    } else {
      UnusableDataSource(id, None, DataSourceStatus.notImportedYet)
    }
  }

  private def resolveDataSourcePaths(dataSourcePath: Path, dataSource: UsableDataSource): List[StaticLayer] =
    dataSource.dataLayers.map { dataLayer =>
      dataLayer.mapped(
        newMags = Some(dataLayer.mags.map { magLocator =>
          magLocator.copy(
            path =
              Some(dataVaultService.resolveMagPath(magLocator, dataSourcePath, dataSourcePath.resolve(dataLayer.name)))
          )
        }),
        attachmentMapping =
          (attachments: DataLayerAttachments) => attachments.resolvedIn(UPath.fromLocalPath(dataSourcePath))
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

  private def addScannedAttachments(dataSourcePath: Path, dataSource: UsableDataSource) =
    dataSource.dataLayers.map { dataLayer =>
      val dataLayerPath = dataSourcePath.resolve(dataLayer.name)
      dataLayer.withMergedAttachments(
        DataLayerAttachments(
          MeshFileInfo.scanForMeshFiles(dataLayerPath),
          AgglomerateFileInfo.scanForAgglomerateFiles(dataLayerPath),
          SegmentIndexFileInfo.scanForSegmentIndexFile(dataLayerPath),
          ConnectomeFileInfo.scanForConnectomeFiles(dataLayerPath),
          CumsumFileInfo.scanForCumsumFile(dataLayerPath)
        ).relativizedIn(UPath.fromLocalPath(dataSourcePath))
      )
    }

  def invalidateVaultCache(dataSource: DataSource, dataLayerName: Option[String]): Option[Int] =
    for {
      usableDataSource <- dataSource.toUsable
      dataLayers = dataLayerName match {
        case Some(ln) => Seq(usableDataSource.getDataLayer(ln))
        case None     => usableDataSource.dataLayers.map(d => Some(d))
      }
      removedEntriesList =
        for {
          dataLayerOpt <- dataLayers
          dataLayer <- dataLayerOpt
          _ = dataLayer.mags.foreach(mag => dataVaultService.removeVaultFromCache(mag))
          _ = dataLayer.attachments.foreach(
            _.allAttachments.foreach(attachment => dataVaultService.removeVaultFromCache(attachment))
          )
        } yield dataLayer.mags.length
    } yield removedEntriesList.sum

  def deleteLocalPathsFromDisk(paths: Seq[UPath]): Box[Unit] = {
    val localBaseDirs = baseDirService.allLocalBaseDirs
    val localPaths =
      paths.filter(_.isLocal).flatMap(_.toLocalPath).filter(p => localBaseDirs.exists(p.toAbsolutePath.startsWith(_)))
    for {
      _ <- localPaths.map(PathUtils.deleteDirectoryRecursively).toList.toSingleBox("Failed to delete local paths")
    } yield ()
  }

}
