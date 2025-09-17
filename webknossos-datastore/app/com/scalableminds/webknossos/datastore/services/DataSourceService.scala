package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.io.PathUtils.ensureDirectoryBox
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.{MagLocator, MappingProvider}
import com.scalableminds.webknossos.datastore.helpers.{DatasetDeleter, IntervalScheduler, MagLinkInfo}
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSource, UnusableDataSource}
import com.scalableminds.webknossos.datastore.storage.{
  CredentialConfigReader,
  DataVaultService,
  RemoteSourceDescriptorService,
  S3AccessKeyCredential
}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools._
import com.scalableminds.webknossos.datastore.datavault.S3DataVault
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.Json
import software.amazon.awssdk.auth.credentials.{AwsBasicCredentials, StaticCredentialsProvider}
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3AsyncClient
import software.amazon.awssdk.services.s3.model.{
  Delete,
  DeleteObjectsRequest,
  DeleteObjectsResponse,
  ListObjectsV2Request,
  ObjectIdentifier
}

import java.io.{File, FileWriter}
import java.net.URI
import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.io.Source
import scala.jdk.CollectionConverters._
import scala.jdk.FutureConverters._

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

  private val propertiesFileName = Path.of(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
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

  private def reportRealPaths(dataSources: List[InboxDataSource]) =
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

  private def determineMagRealPathsForDataSource(dataSource: InboxDataSource) = tryo {
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

  private def logFoundDatasources(foundInboxSources: Seq[InboxDataSource],
                                  verbose: Boolean,
                                  selectedOrgaLabel: String): Unit = {
    val shortForm =
      s"Finished scanning inbox ($dataBaseDir$selectedOrgaLabel): ${foundInboxSources.count(_.isUsable)} active, ${foundInboxSources
        .count(!_.isUsable)} inactive"
    val msg = if (verbose) {
      val byTeam: Map[String, Seq[InboxDataSource]] = foundInboxSources.groupBy(_.id.organizationId)
      shortForm + ". " + byTeam.keys.map { team =>
        val byUsable: Map[Boolean, Seq[InboxDataSource]] = byTeam(team).groupBy(_.isUsable)
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

  private def validateDataSource(dataSource: DataSource, organizationDir: Path): Box[Unit] = {
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

  def updateDataSourceOnDisk(dataSource: DataSource, expectExisting: Boolean, preventNewPaths: Boolean): Fox[Unit] = {
    val organizationDir = dataBaseDir.resolve(dataSource.id.organizationId)
    val dataSourcePath = organizationDir.resolve(dataSource.id.directoryName)
    for {
      _ <- validateDataSource(dataSource, organizationDir).toFox
      propertiesFile = dataSourcePath.resolve(propertiesFileName)
      _ <- Fox.runIf(!expectExisting)(ensureDirectoryBox(dataSourcePath).toFox)
      _ <- Fox.runIf(!expectExisting)(Fox.fromBool(!Files.exists(propertiesFile))) ?~> "dataSource.alreadyPresent"
      _ <- Fox.runIf(expectExisting && preventNewPaths)(assertNoNewPaths(dataSourcePath, dataSource)) ?~> "dataSource.update.newExplicitPaths"
      _ <- Fox.runIf(expectExisting)(backupPreviousProperties(dataSourcePath).toFox) ?~> "Could not update datasource-properties.json"
      _ <- JsonHelper.writeToFile(propertiesFile, dataSource).toFox ?~> "Could not update datasource-properties.json"
    } yield ()
  }

  private def assertNoNewPaths(dataSourcePath: Path, newDataSource: DataSource): Fox[Unit] = {
    val propertiesPath = dataSourcePath.resolve(propertiesFileName)
    if (Files.exists(propertiesPath)) {
      Fox
        .runOptional(newDataSource.toUsable) { newUsableDataSource =>
          Fox.runOptional(dataSourceFromDir(dataSourcePath, newDataSource.id.organizationId).toUsable) {
            oldUsableDataSource =>
              val oldPaths = oldUsableDataSource.allExplicitPaths.toSet
              Fox.fromBool(newUsableDataSource.allExplicitPaths.forall(oldPaths.contains))
          }
        }
        .map(_ => ())
    } else {
      Fox.successful(())
    }
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

  private def scanOrganizationDirForDataSources(path: Path): List[InboxDataSource] = {
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

  def dataSourceFromDir(path: Path, organizationId: String): InboxDataSource = {
    val id = DataSourceId(path.getFileName.toString, organizationId)
    val propertiesFile = path.resolve(propertiesFileName)

    if (new File(propertiesFile.toString).exists()) {
      JsonHelper.parseFromFileAs[DataSource](propertiesFile, path) match {
        case Full(dataSource) =>
          if (dataSource.dataLayers.nonEmpty) {
            val dataSourceWithAttachments = dataSource.copy(
              dataLayers = scanForAttachedFiles(path, dataSource)
            )
            dataSourceWithAttachments.copy(id)
          } else
            UnusableDataSource(id, "Error: Zero layer Dataset", Some(dataSource.scale), Some(Json.toJson(dataSource)))
        case e =>
          UnusableDataSource(id,
                             s"Error: Invalid json format in $propertiesFile: $e",
                             existingDataSourceProperties = JsonHelper.parseFromFile(propertiesFile, path).toOption)
      }
    } else {
      UnusableDataSource(id, "Not imported yet.")
    }
  }

  // Prepend newBasePath to all (relative) paths in mags and attachments of the data source.
  def prependAllPaths(dataSource: InboxDataSource, newBasePath: String): Fox[DataSource] = {
    val replaceUri = (uri: URI) => {
      val isRelativeFilePath = (uri.getScheme == null || uri.getScheme.isEmpty || uri.getScheme == DataVaultService.schemeFile) && !uri.isAbsolute
      uri.getPath match {
        case pathStr if isRelativeFilePath =>
          new URI(uri.getScheme,
                  uri.getUserInfo,
                  uri.getHost,
                  uri.getPort,
                  newBasePath + pathStr,
                  uri.getQuery,
                  uri.getFragment)
        case _ => uri
      }
    }

    dataSource.toUsable match {
      case Some(usableDataSource) =>
        val updatedDataLayers = usableDataSource.dataLayers.map {
          case layerWithMagLocators: DataLayerWithMagLocators =>
            layerWithMagLocators.mapped(
              identity,
              identity,
              mag =>
                mag.path match {
                  case Some(pathStr) => mag.copy(path = Some(replaceUri(new URI(pathStr)).toString))
                  // If the mag does not have a path, it is an implicit path, we need to make it explicit.
                  case _ =>
                    mag.copy(
                      path = Some(
                        new URI(newBasePath)
                          .resolve(List(layerWithMagLocators.name, mag.mag.toMagLiteral(true)).mkString("/"))
                          .toString))
              },
              attachmentMapping = attachment =>
                DatasetLayerAttachments(
                  attachment.meshes.map(a => a.copy(path = replaceUri(a.path))),
                  attachment.agglomerates.map(a => a.copy(path = replaceUri(a.path))),
                  attachment.segmentIndex.map(a => a.copy(path = replaceUri(a.path))),
                  attachment.connectomes.map(a => a.copy(path = replaceUri(a.path))),
                  attachment.cumsum.map(a => a.copy(path = replaceUri(a.path)))
              )
            )
          case layer => layer
        }
        Fox.successful(usableDataSource.copy(dataLayers = updatedDataLayers))
      case None =>
        Fox.failure("Cannot replace paths of unusable datasource")
    }
  }

  private def scanForAttachedFiles(dataSourcePath: Path, dataSource: DataSource) =
    dataSource.dataLayers.map(dataLayer => {
      val dataLayerPath = dataSourcePath.resolve(dataLayer.name)
      dataLayer.withAttachments(
        DatasetLayerAttachments(
          MeshFileInfo.scanForMeshFiles(dataLayerPath),
          AgglomerateFileInfo.scanForAgglomerateFiles(dataLayerPath),
          SegmentIndexFileInfo.scanForSegmentIndexFile(dataLayerPath),
          ConnectomeFileInfo.scanForConnectomeFiles(dataLayerPath),
          CumsumFileInfo.scanForCumsumFile(dataLayerPath)
        ))
    })

  def invalidateVaultCache(dataSource: InboxDataSource, dataLayerName: Option[String]): Option[Int] =
    for {
      genericDataSource <- dataSource.toUsable
      dataLayers = dataLayerName match {
        case Some(ln) => Seq(genericDataSource.getDataLayer(ln))
        case None     => genericDataSource.dataLayers.map(d => Some(d))
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

  private lazy val globalCredentials = {
    val res = config.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
      new CredentialConfigReader(credentialConfig).getCredential
    }
    logger.info(s"Parsed ${res.length} global data vault credentials from datastore config.")
    res
  }

  def datasetInControlledS3(dataSource: DataSource): Boolean = {
    def commonPrefix(strings: Seq[String]): String = {
      if (strings.isEmpty) return ""

      strings.reduce { (a, b) =>
        a.zip(b).takeWhile { case (c1, c2) => c1 == c2 }.map(_._1).mkString
      }
    }

    val allPaths = dataSource.allExplicitPaths
    val sharedPath = commonPrefix(allPaths)
    val matchingCredentials = globalCredentials.filter(c => sharedPath.startsWith(c.name))
    matchingCredentials.nonEmpty && sharedPath.startsWith("s3")
  }

  private lazy val s3UploadCredentialsOpt: Option[(String, String)] =
    config.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
      new CredentialConfigReader(credentialConfig).getCredential
    }.collectFirst {
      case S3AccessKeyCredential(credentialName, accessKeyId, secretAccessKey, _, _)
          if config.Datastore.S3Upload.credentialName == credentialName =>
        (accessKeyId, secretAccessKey)
    }
  private lazy val s3Client: S3AsyncClient = S3AsyncClient
    .builder()
    .credentialsProvider(
      StaticCredentialsProvider.create(
        AwsBasicCredentials.builder
          .accessKeyId(s3UploadCredentialsOpt.getOrElse(("", ""))._1)
          .secretAccessKey(s3UploadCredentialsOpt.getOrElse(("", ""))._2)
          .build()
      ))
    .crossRegionAccessEnabled(true)
    .forcePathStyle(true)
    .endpointOverride(new URI(config.Datastore.S3Upload.endpoint))
    .region(Region.US_EAST_1)
    // Disabling checksum calculation prevents files being stored with Content Encoding "aws-chunked".
    .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
    .build()

  def deleteFromControlledS3(dataSource: DataSource, datasetId: ObjectId): Fox[Unit] = {
    def deleteBatch(bucket: String, keys: Seq[String]): Fox[DeleteObjectsResponse] =
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

    def listKeysAtPrefix(bucket: String, prefix: String): Fox[Seq[String]] = {
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
      magsLinkedByOtherDatasets: Set[MagLinkInfo] = layersAndLinkedMags
        .flatMap(layerInfo => layerInfo.magLinkInfos.filter(_.linkedMags.nonEmpty))
        .toSet
      linkedMagPaths = magsLinkedByOtherDatasets.flatMap(_.linkedMags).flatMap(_.path)
      paths = dataSource.allExplicitPaths.filterNot(path => linkedMagPaths.contains(path))
      _ <- Fox.runIf(paths.nonEmpty)({
        for {
          // Assume everything is in the same bucket
          firstPath <- paths.headOption.toFox
          bucket <- S3DataVault
            .hostBucketFromUri(new URI(firstPath))
            .toFox ?~> s"Could not determine S3 bucket from path $firstPath"
          prefixes <- Fox.combined(paths.map(path => S3DataVault.objectKeyFromUri(new URI(path)).toFox))
          keys: Seq[String] <- Fox.serialCombined(prefixes)(listKeysAtPrefix(bucket, _)).map(_.flatten)
          uniqueKeys = keys.distinct
          _ = logger.info(
            s"Deleting ${uniqueKeys.length} objects from controlled S3 bucket $bucket for dataset ${dataSource.id}")
          _ <- Fox.serialCombined(uniqueKeys.grouped(1000).toSeq)(deleteBatch(bucket, _)).map(_ => ())
        } yield ()
      })
    } yield ()
  }
}
