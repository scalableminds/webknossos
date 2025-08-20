package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.io.PathUtils.ensureDirectoryBox
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.{MagLocator, MappingProvider}
import com.scalableminds.webknossos.datastore.helpers.{DatasetDeleter, IntervalScheduler}
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptorService}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools._
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.Json

import java.io.{File, FileWriter}
import java.net.URI
import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.io.Source

class DataSourceService @Inject()(
    config: DataStoreConfig,
    remoteSourceDescriptorService: RemoteSourceDescriptorService,
    val remoteWebknossosClient: DSRemoteWebknossosClient,
    val lifecycle: ApplicationLifecycle,
    @Named("webknossos-datastore") val actorSystem: ActorSystem
)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with DatasetDeleter
    with LazyLogging
    with FoxImplicits
    with Formatter {

  override protected def tickerEnabled: Boolean = config.Datastore.WatchFileSystem.enabled
  override protected def tickerInterval: FiniteDuration = config.Datastore.WatchFileSystem.interval

  override protected def tickerInitialDelay: FiniteDuration = config.Datastore.WatchFileSystem.initialDelay

  val dataBaseDir: Path = Path.of(config.Datastore.baseDirectory)

  private val propertiesFileName = Path.of(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
  private val logFileName = Path.of("datasource-properties-backups.log")

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
    val selectedOrgaLabel = organizationId.map(id => s"/$id").getOrElse("")
    def orgaFilterFn(organizationId: String): Path => Boolean =
      (path: Path) => path.getFileName.toString == organizationId
    val selectedOrgaFilter: Path => Boolean = organizationId.map(id => orgaFilterFn(id)).getOrElse((_: Path) => true)
    if (verbose) logger.info(s"Scanning inbox ($dataBaseDir$selectedOrgaLabel)...")
    for {
      _ <- PathUtils.listDirectories(dataBaseDir, silent = false, filters = selectedOrgaFilter) match {
        case Full(organizationDirs) =>
          if (verbose && organizationId.isEmpty) logEmptyDirs(organizationDirs)
          val foundInboxSources = organizationDirs.flatMap(scanOrganizationDirForDataSources)
          logFoundDatasources(foundInboxSources, verbose, selectedOrgaLabel)
          for {
            _ <- remoteWebknossosClient.reportDataSources(foundInboxSources, organizationId)
            _ <- reportRealPaths(foundInboxSources)
          } yield ()
        case e =>
          val errorMsg = s"Failed to scan inbox. Error during list directories on '$dataBaseDir$selectedOrgaLabel': $e"
          logger.error(errorMsg)
          Fox.failure(errorMsg)
      }
    } yield ()
  }

  private def reportRealPaths(dataSources: List[DataSource]) =
    for {
      _ <- Fox.successful(())
      magPathBoxes = dataSources.map(ds => (ds, determineMagRealPathsForDataSource(ds)))
      pathInfos = magPathBoxes.map {
        case (ds, Full(magPaths)) => DataSourcePathInfo(ds.id, magPaths)
        case (ds, failure: Failure) =>
          logger.error(s"Failed to determine real paths of mags of ${ds.id}: ${formatFailureChain(failure)}")
          DataSourcePathInfo(ds.id, List())
        case (ds, Empty) =>
          logger.error(s"Failed to determine real paths for mags of ${ds.id}")
          DataSourcePathInfo(ds.id, List())
      }
      _ <- remoteWebknossosClient.reportRealPaths(pathInfos)
    } yield ()

  private def determineMagRealPathsForDataSource(dataSource: DataSource) = tryo {
    val organizationPath = dataBaseDir.resolve(dataSource.id.organizationId)
    val datasetPath = organizationPath.resolve(dataSource.id.directoryName)
    dataSource.toUsable match {
      case Some(usableDataSource) =>
        usableDataSource.dataLayers.flatMap { dataLayer =>
          val rawLayerPath = datasetPath.resolve(dataLayer.name)
          val absoluteLayerPath = if (Files.isSymbolicLink(rawLayerPath)) {
            resolveRelativePath(datasetPath, Files.readSymbolicLink(rawLayerPath))
          } else {
            rawLayerPath.toAbsolutePath
          }
          dataLayer.mags.map { mag =>
            getMagPathInfo(datasetPath, absoluteLayerPath, rawLayerPath, dataLayer, mag)
          }
        }
      case None => List()
    }
  }

  private def getMagPathInfo(datasetPath: Path,
                             absoluteLayerPath: Path,
                             rawLayerPath: Path,
                             dataLayer: DataLayer,
                             mag: MagLocator) = {
    val (magURI, isRemote) = getMagURI(datasetPath, absoluteLayerPath, mag)
    if (isRemote) {
      MagPathInfo(dataLayer.name, mag.mag, magURI.toString, magURI.toString, hasLocalData = false)
    } else {
      val magPath = Path.of(magURI.getPath)
      val realPath = magPath.toRealPath()
      // Does this dataset have local data, i.e. the data that is referenced by the mag path is within the dataset directory
      val isLocal = realPath.startsWith(datasetPath.toAbsolutePath)
      val unresolvedPath =
        rawLayerPath.toAbsolutePath.resolve(absoluteLayerPath.relativize(magPath)).normalize()
      MagPathInfo(dataLayer.name,
                  mag.mag,
                  unresolvedPath.toUri.toString,
                  realPath.toUri.toString,
                  hasLocalData = isLocal)
    }
  }

  private def getMagURI(datasetPath: Path, layerPath: Path, mag: MagLocator): (URI, Boolean) = {
    val uri = remoteSourceDescriptorService.resolveMagPath(
      datasetPath,
      layerPath,
      layerPath.getFileName.toString,
      mag
    )
    (uri, uri.getScheme != null && DataVaultService.isRemoteScheme(uri.getScheme))
  }

  private def resolveRelativePath(basePath: Path, relativePath: Path): Path =
    if (relativePath.isAbsolute) {
      relativePath
    } else {
      basePath.resolve(relativePath).normalize().toAbsolutePath
    }

  private def logFoundDatasources(foundInboxSources: Seq[DataSource],
                                  verbose: Boolean,
                                  selectedOrgaLabel: String): Unit = {
    val shortForm =
      s"Finished scanning inbox ($dataBaseDir$selectedOrgaLabel): ${foundInboxSources.count(_.isUsable)} active, ${foundInboxSources
        .count(!_.isUsable)} inactive"
    val msg = if (verbose) {
      val byTeam: Map[String, Seq[DataSource]] = foundInboxSources.groupBy(_.id.organizationId)
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

  def exploreMappings(organizationId: String, datasetName: String, dataLayerName: String): Set[String] =
    MappingProvider
      .exploreMappings(dataBaseDir.resolve(organizationId).resolve(datasetName).resolve(dataLayerName))
      .getOrElse(Set())

  private def validateDataSource(dataSource: UsableDataSource, organizationDir: Path): Box[Unit] = {
    def Check(expression: Boolean, msg: String): Option[String] = if (!expression) Some(msg) else None

    // Check that when mags are sorted by max dimension, all dimensions are sorted.
    // This means each dimension increases monotonically.
    val magsSorted = dataSource.dataLayers.map(_.resolutions.sortBy(_.maxDim))
    val magsXIsSorted = magsSorted.map(_.map(_.x)) == magsSorted.map(_.map(_.x).sorted)
    val magsYIsSorted = magsSorted.map(_.map(_.y)) == magsSorted.map(_.map(_.y).sorted)
    val magsZIsSorted = magsSorted.map(_.map(_.z)) == magsSorted.map(_.map(_.z).sorted)

    def pathOk(pathStr: String): Boolean = {
      val uri = new URI(pathStr)
      if (DataVaultService.isRemoteScheme(uri.getScheme)) true
      else {
        val path = organizationDir
          .resolve(dataSource.id.directoryName)
          .resolve(Path.of(new URI(pathStr).getPath).normalize())
          .toAbsolutePath
        val allowedParent = organizationDir.toAbsolutePath
        if (path.startsWith(allowedParent)) true else false
      }
    }

    val errors = List(
      Check(dataSource.scale.factor.isStrictlyPositive, "DataSource voxel size (scale) is invalid"),
      Check(magsXIsSorted && magsYIsSorted && magsZIsSorted, "Mags do not monotonically increase in all dimensions"),
      Check(dataSource.dataLayers.nonEmpty, "DataSource must have at least one dataLayer"),
      Check(dataSource.dataLayers.forall(!_.boundingBox.isEmpty), "DataSource bounding box must not be empty"),
      Check(
        dataSource.segmentationLayers.forall { layer =>
          ElementClass.segmentationElementClasses.contains(layer.elementClass)
        },
        s"Invalid element class for segmentation layer"
      ),
      Check(
        dataSource.segmentationLayers.forall { layer =>
          ElementClass.largestSegmentIdIsInRange(layer.largestSegmentId, layer.elementClass)
        },
        "Largest segment id exceeds range (must be nonnegative, within element class range, and < 2^53)"
      ),
      Check(
        dataSource.dataLayers.map(_.name).distinct.length == dataSource.dataLayers.length,
        "Layer names must be unique. At least two layers have the same name."
      ),
      Check(
        dataSource.dataLayers.flatMap(_.mags).flatMap(_.path).forall(pathOk),
        "Mags with explicit paths must stay within the organization directory."
      )
    ).flatten

    if (errors.isEmpty) {
      Full(())
    } else {
      ParamFailure("DataSource is invalid", Json.toJson(errors.map(e => Json.obj("error" -> e))))
    }
  }

  def updateDataSourceOnDisk(dataSource: UsableDataSource, expectExisting: Boolean): Fox[Unit] = {
    val organizationDir = dataBaseDir.resolve(dataSource.id.organizationId)
    val dataSourcePath = organizationDir.resolve(dataSource.id.directoryName)
    for {
      _ <- validateDataSource(dataSource, organizationDir).toFox
      propertiesFile = dataSourcePath.resolve(propertiesFileName)
      _ <- Fox.runIf(!expectExisting)(ensureDirectoryBox(dataSourcePath).toFox)
      _ <- Fox.runIf(!expectExisting)(Fox.fromBool(!Files.exists(propertiesFile))) ?~> "dataSource.alreadyPresent"
      _ <- Fox.runIf(expectExisting)(backupPreviousProperties(dataSourcePath).toFox) ?~> "Could not update datasource-properties.json"
      _ <- JsonHelper.writeToFile(propertiesFile, dataSource).toFox ?~> "Could not update datasource-properties.json"
    } yield ()
  }

  private def backupPreviousProperties(dataSourcePath: Path): Box[Unit] = {
    val propertiesFile = dataSourcePath.resolve(propertiesFileName)
    val previousContentOrEmpty = if (Files.exists(propertiesFile)) {
      val previousContentSource = Source.fromFile(propertiesFile.toString)
      val previousContent = previousContentSource.getLines().mkString("\n")
      previousContentSource.close()
      previousContent
    } else {
      "<empty>"
    }
    val outputForLogfile =
      f"Contents of $propertiesFileName were changed by WEBKNOSSOS at ${Instant.now}. Old content: \n\n$previousContentOrEmpty\n\n"
    val logfilePath = dataSourcePath.resolve(logFileName)
    try {
      val fileWriter = new FileWriter(logfilePath.toString, true)
      try {
        fileWriter.write(outputForLogfile)
        Full(())
      } finally fileWriter.close()
    } catch {
      case e: Exception => Failure(s"Could not back up old contents: ${e.toString}")
    }
  }

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
          if (dataSource.dataLayers.nonEmpty) {
            val dataSourceWithAttachments = dataSource.copy(
              dataLayers = scanForAttachedFiles(path, dataSource)
            )
            dataSourceWithAttachments.copy(id)
          } else
            UnusableDataSource(id,
                               None,
                               "Error: Zero layer Dataset",
                               Some(dataSource.scale),
                               Some(Json.toJson(dataSource)))
        case e =>
          UnusableDataSource(id,
                             None,
                             s"Error: Invalid json format in $propertiesFile: $e",
                             existingDataSourceProperties = JsonHelper.parseFromFile(propertiesFile, path).toOption)
      }
    } else {
      UnusableDataSource(id, None, "Not imported yet.")
    }
  }

  private def scanForAttachedFiles(dataSourcePath: Path, dataSource: UsableDataSource) =
    dataSource.dataLayers.map(dataLayer => {
      val dataLayerPath = dataSourcePath.resolve(dataLayer.name)
      dataLayer.withAttachments(
        DataLayerAttachments(
          MeshFileInfo.scanForMeshFiles(dataLayerPath),
          AgglomerateFileInfo.scanForAgglomerateFiles(dataLayerPath),
          SegmentIndexFileInfo.scanForSegmentIndexFile(dataLayerPath),
          ConnectomeFileInfo.scanForConnectomeFiles(dataLayerPath),
          CumsumFileInfo.scanForCumsumFile(dataLayerPath)
        ))
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
        _ = dataLayer.mags.foreach(mag =>
          remoteSourceDescriptorService.removeVaultFromCache(dataBaseDir, dataSource.id, dataLayer.name, mag))
        _ = dataLayer.attachments.foreach(_.allAttachments.foreach(attachment =>
          remoteSourceDescriptorService.removeVaultFromCache(attachment)))
      } yield dataLayer.mags.length
    } yield removedEntriesList.sum

  def applyDataSourceUpdates(existingDataSource: UsableDataSource, updates: UsableDataSource): UsableDataSource = {
    val updatedLayers = existingDataSource.dataLayers.flatMap { existingLayer =>
      val layerUpdatesOpt = updates.dataLayers.find(_.name == existingLayer.name)
      layerUpdatesOpt match {
        case Some(layerUpdates) => Some(applyLayerUpdates(existingLayer, layerUpdates))
        case None               => None
      }
    }
    existingDataSource.copy(
      dataLayers = updatedLayers,
      scale = updates.scale
    )
  }

  private def applyLayerUpdates(existingLayer: StaticLayer, layerUpdates: StaticLayer): StaticLayer =
    /*
    Taken from the new layer are only those properties:
     - category (so Color may become Segmentation and vice versa)
     - boundingBox
     - coordinatesTransformations
     - defaultViewConfiguration
     - adminViewConfiguration
     - largestSegmentId (segmentation only)
     */

    existingLayer match {
      case e: StaticColorLayer =>
        layerUpdates match {
          case u: StaticColorLayer =>
            e.copy(
              boundingBox = u.boundingBox,
              coordinateTransformations = u.coordinateTransformations,
              defaultViewConfiguration = u.defaultViewConfiguration,
              adminViewConfiguration = u.adminViewConfiguration
            )
          case u: StaticSegmentationLayer =>
            StaticSegmentationLayer(
              e.name,
              e.dataFormat,
              u.boundingBox,
              e.elementClass,
              e.mags,
              u.defaultViewConfiguration,
              u.adminViewConfiguration,
              u.coordinateTransformations,
              e.additionalAxes,
              e.attachments,
              u.largestSegmentId,
              None
            )
        }
      case e: StaticSegmentationLayer =>
        layerUpdates match {
          case u: StaticSegmentationLayer =>
            e.copy(
              boundingBox = u.boundingBox,
              coordinateTransformations = u.coordinateTransformations,
              defaultViewConfiguration = u.defaultViewConfiguration,
              adminViewConfiguration = u.adminViewConfiguration,
              largestSegmentId = u.largestSegmentId
            )
          case u: StaticColorLayer =>
            StaticColorLayer(
              e.name,
              e.dataFormat,
              u.boundingBox,
              e.elementClass,
              e.mags,
              u.defaultViewConfiguration,
              u.adminViewConfiguration,
              u.coordinateTransformations,
              e.additionalAxes,
              e.attachments
            )
        }
    }
}
