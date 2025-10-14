package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.{MagLocator, MappingProvider}
import com.scalableminds.webknossos.datastore.helpers.{DatasetDeleter, IntervalScheduler, MagLinkInfo, UPath}
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.{CredentialConfigReader, RemoteSourceDescriptorService}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools._
import com.scalableminds.webknossos.datastore.datavault.S3DataVault
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.Json
import software.amazon.awssdk.services.s3.S3AsyncClient
import software.amazon.awssdk.services.s3.model.{
  Delete,
  DeleteObjectsRequest,
  DeleteObjectsResponse,
  ListObjectsV2Request,
  ObjectIdentifier
}

import java.io.File
import java.net.URI
import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.jdk.CollectionConverters._
import scala.jdk.FutureConverters._

class DataSourceService @Inject()(
    config: DataStoreConfig,
    remoteSourceDescriptorService: RemoteSourceDescriptorService,
    managedS3Service: ManagedS3Service,
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
    val absoluteDatasetPath = dataBaseDir.resolve(dataSource.id.organizationId).resolve(dataSource.id.directoryName)
    dataSource.toUsable match {
      case Some(usableDataSource) =>
        usableDataSource.dataLayers.flatMap { dataLayer =>
          val absoluteRawLayerPath = absoluteDatasetPath.resolve(dataLayer.name)
          val absoluteRealLayerPath = if (Files.isSymbolicLink(absoluteRawLayerPath)) {
            resolveRelativePath(absoluteDatasetPath, Files.readSymbolicLink(absoluteRawLayerPath))
          } else {
            absoluteRawLayerPath.toAbsolutePath
          }
          dataLayer.mags.map { mag =>
            getMagPathInfo(absoluteDatasetPath, absoluteRealLayerPath, absoluteRawLayerPath, dataLayer, mag)
          }
        }
      case None => List()
    }
  }

  private def getMagPathInfo(absoluteDatasetPath: Path,
                             absoluteRealLayerPath: Path,
                             absoluteRawLayerPath: Path,
                             dataLayer: DataLayer,
                             mag: MagLocator) = {
    val resolvedMagPath = resolveMagPath(absoluteDatasetPath, absoluteRealLayerPath, mag)
    if (resolvedMagPath.isRemote) {
      MagPathInfo(dataLayer.name, mag.mag, resolvedMagPath, resolvedMagPath, hasLocalData = false)
    } else {
      val magPath = resolvedMagPath.toLocalPathUnsafe
      val realMagPath = magPath.toRealPath()
      // Does this dataset have local data, i.e. the data that is referenced by the mag path is within the dataset directory
      val isDatasetLocal = realMagPath.startsWith(absoluteDatasetPath.toAbsolutePath)
      val absoluteUnresolvedPath = absoluteRawLayerPath.resolve(absoluteRealLayerPath.relativize(magPath)).normalize()
      MagPathInfo(dataLayer.name,
                  mag.mag,
                  UPath.fromLocalPath(absoluteUnresolvedPath),
                  UPath.fromLocalPath(realMagPath),
                  hasLocalData = isDatasetLocal)
    }
  }

  private def resolveMagPath(datasetPath: Path, layerPath: Path, mag: MagLocator): UPath =
    remoteSourceDescriptorService.resolveMagPath(
      datasetPath,
      layerPath,
      layerPath.getFileName.toString,
      mag
    )

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
            dataSourceWithAttachments.copy(id)
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
        _ = dataLayer.mags.foreach(mag =>
          remoteSourceDescriptorService.removeVaultFromCache(dataBaseDir, dataSource.id, dataLayer.name, mag))
        _ = dataLayer.attachments.foreach(_.allAttachments.foreach(attachment =>
          remoteSourceDescriptorService.removeVaultFromCache(attachment)))
      } yield dataLayer.mags.length
    } yield removedEntriesList.sum

  // TODO move to ManagedS3Service
  private lazy val globalCredentials = {
    val res = config.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
      new CredentialConfigReader(credentialConfig).getCredential
    }
    logger.info(s"Parsed ${res.length} global data vault credentials from datastore config.")
    res
  }

  def datasetIsInManagedS3(dataSource: UsableDataSource): Boolean = {
    def commonPrefix(strings: Seq[String]): String = {
      if (strings.isEmpty) return ""

      strings.reduce { (a, b) =>
        a.zip(b).takeWhile { case (c1, c2) => c1 == c2 }.map(_._1).mkString
      }
    }

    val allPaths = dataSource.allExplicitPaths
    val sharedPath = commonPrefix(allPaths.map(_.toString))
    val matchingCredentials = globalCredentials.filter(c => sharedPath.startsWith(c.name))
    matchingCredentials.nonEmpty && sharedPath.startsWith("s3")
  }

  def deleteFromManagedS3(dataSource: UsableDataSource, datasetId: ObjectId): Fox[Unit] = {
    def deleteBatch(s3Client: S3AsyncClient, bucket: String, keys: Seq[String]): Fox[DeleteObjectsResponse] =
      if (keys.isEmpty) Fox.empty
      else {
        Fox.fromFuture(
          s3Client
            .deleteObjects(
              DeleteObjectsRequest
                .builder()
                .bucket(bucket)
                .delete(
                  Delete
                    .builder()
                    .objects(
                      keys.map(k => ObjectIdentifier.builder().key(k).build()).asJava
                    )
                    .build()
                )
                .build()
            )
            .asScala)
      }

    def listKeysAtPrefix(s3Client: S3AsyncClient, bucket: String, prefix: String): Fox[Seq[String]] = {
      def listRec(continuationToken: Option[String], acc: Seq[String]): Fox[Seq[String]] = {
        val builder = ListObjectsV2Request.builder().bucket(bucket).prefix(prefix).maxKeys(1000)
        val request = continuationToken match {
          case Some(token) => builder.continuationToken(token).build()
          case None        => builder.build()
        }
        for {
          response <- Fox.fromFuture(s3Client.listObjectsV2(request).asScala)
          keys = response.contents().asScala.map(_.key())
          allKeys = acc ++ keys
          result <- if (response.isTruncated) {
            listRec(Option(response.nextContinuationToken()), allKeys)
          } else {
            Fox.successful(allKeys)
          }
        } yield result
      }
      listRec(None, Seq())
    }

    for {
      _ <- Fox.successful(())
      layersAndLinkedMags <- remoteWebknossosClient.fetchPaths(datasetId)
      s3Client <- managedS3Service.s3ClientBox.toFox
      magsLinkedByOtherDatasets: Set[MagLinkInfo] = layersAndLinkedMags
        .flatMap(layerInfo => layerInfo.magLinkInfos.filter(_.linkedMags.nonEmpty))
        .toSet
      linkedMagPaths = magsLinkedByOtherDatasets.flatMap(_.linkedMags).flatMap(_.path)
      paths = dataSource.allExplicitPaths.filterNot(path => linkedMagPaths.contains(path.toString))
      _ <- Fox.runIf(paths.nonEmpty)({
        for {
          // Assume everything is in the same bucket
          firstPath <- paths.headOption.toFox
          bucket <- S3DataVault
            .hostBucketFromUri(new URI(firstPath.toString))
            .toFox ?~> s"Could not determine S3 bucket from path $firstPath"
          prefixes <- Fox.combined(paths.map(path => S3DataVault.objectKeyFromUri(new URI(path.toString)).toFox))
          keys: Seq[String] <- Fox.serialCombined(prefixes)(listKeysAtPrefix(s3Client, bucket, _)).map(_.flatten)
          uniqueKeys = keys.distinct
          _ = logger.info(
            s"Deleting ${uniqueKeys.length} objects from managed S3 bucket $bucket for dataset ${dataSource.id}")
          _ <- Fox.serialCombined(uniqueKeys.grouped(1000).toSeq)(deleteBatch(s3Client, bucket, _)).map(_ => ())
        } yield ()
      })
    } yield ()
  }
}
