package com.scalableminds.webknossos.datastore.services.uploading

import com.google.inject.Inject
import com.scalableminds.util.io.PathUtils.ensureDirectoryBox
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.layers.{WKWDataLayer, WKWSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Header.FILENAME_ATTRIBUTES_JSON
import com.scalableminds.webknossos.datastore.datareaders.n5.{N5Header, N5Metadata}
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedHeader.FILENAME_INFO
import com.scalableminds.webknossos.datastore.datareaders.zarr.NgffMetadata.FILENAME_DOT_ZATTRS
import com.scalableminds.webknossos.datastore.datareaders.zarr.ZarrHeader.FILENAME_DOT_ZARRAY
import com.scalableminds.webknossos.datastore.explore.ExploreLocalLayerService
import com.scalableminds.webknossos.datastore.helpers.{DatasetDeleter, DirectoryConstants}
import com.scalableminds.webknossos.datastore.models.datasource.GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.services.{DataSourceRepository, DataSourceService}
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common._
import org.apache.commons.io.FileUtils
import play.api.libs.json.{Json, OFormat, Reads}

import java.io.{File, RandomAccessFile}
import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext

case class ReserveUploadInformation(
    uploadId: String, // upload id that was also used in chunk upload (this time without file paths)
    name: String, // dataset name
    organization: String,
    totalFileCount: Long,
    layersToLink: Option[List[LinkedLayerIdentifier]],
    initialTeams: List[String], // team ids
    folderId: Option[String])
object ReserveUploadInformation {
  implicit val reserveUploadInformation: OFormat[ReserveUploadInformation] = Json.format[ReserveUploadInformation]
}
case class ReserveManualUploadInformation(datasetName: String,
                                          organization: String,
                                          initialTeamIds: List[String],
                                          folderId: Option[String])
object ReserveManualUploadInformation {
  implicit val reserveUploadInformation: OFormat[ReserveManualUploadInformation] =
    Json.format[ReserveManualUploadInformation]
}

case class LinkedLayerIdentifier(organizationName: String,
                                 dataSetName: String,
                                 layerName: String,
                                 newLayerName: Option[String] = None) {
  def pathIn(dataBaseDir: Path): Path = dataBaseDir.resolve(organizationName).resolve(dataSetName).resolve(layerName)
}

object LinkedLayerIdentifier {
  implicit val jsonFormat: OFormat[LinkedLayerIdentifier] = Json.format[LinkedLayerIdentifier]
}

case class LinkedLayerIdentifiers(layersToLink: Option[List[LinkedLayerIdentifier]])
object LinkedLayerIdentifiers {
  implicit val jsonFormat: OFormat[LinkedLayerIdentifiers] = Json.format[LinkedLayerIdentifiers]
}

case class UploadInformation(uploadId: String, needsConversion: Option[Boolean])

object UploadInformation {
  implicit val jsonFormat: OFormat[UploadInformation] = Json.format[UploadInformation]
}

case class CancelUploadInformation(uploadId: String)
object CancelUploadInformation {
  implicit val jsonFormat: OFormat[CancelUploadInformation] = Json.format[CancelUploadInformation]
}

class UploadService @Inject()(dataSourceRepository: DataSourceRepository,
                              dataSourceService: DataSourceService,
                              runningUploadMetadataStore: DataStoreRedisStore,
                              exploreLocalLayerService: ExploreLocalLayerService,
                              datasetSymlinkService: DatasetSymlinkService)(implicit ec: ExecutionContext)
    extends DatasetDeleter
    with DirectoryConstants
    with FoxImplicits
    with BoxImplicits
    with WKWDataFormatHelper
    with LazyLogging {

  /* Redis stores different information for each upload, with different prefixes in the keys:
   *  uploadId -> fileCount
   *  uploadId -> set(fileName)
   *  uploadId -> dataSourceId
   *  uploadId -> linkedLayerIdentifier
   *  uploadId#fileName -> totalChunkCount
   *  uploadId#fileName -> set(chunkIndices)
   * Note that Redis synchronizes all db accesses, so we do not need to do it
   */
  private def redisKeyForFileCount(uploadId: String): String =
    s"upload___${uploadId}___fileCount"
  private def redisKeyForFileNameSet(uploadId: String): String =
    s"upload___${uploadId}___fileNameSet"
  private def redisKeyForDataSourceId(uploadId: String): String =
    s"upload___${uploadId}___dataSourceId"
  private def redisKeyForLinkedLayerIdentifier(uploadId: String): String =
    s"upload___${uploadId}___linkedLayerIdentifier"
  private def redisKeyForFileChunkCount(uploadId: String, fileName: String): String =
    s"upload___${uploadId}___file___${fileName}___chunkCount"
  private def redisKeyForFileChunkSet(uploadId: String, fileName: String): String =
    s"upload___${uploadId}___file___${fileName}___chunkSet"

  cleanUpOrphanUploads()

  override def dataBaseDir: Path = dataSourceService.dataBaseDir

  def isKnownUploadByFileId(uploadFileId: String): Fox[Boolean] = isKnownUpload(extractDatasetUploadId(uploadFileId))

  def isKnownUpload(uploadId: String): Fox[Boolean] =
    runningUploadMetadataStore.contains(redisKeyForFileCount(uploadId))

  def extractDatasetUploadId(uploadFileId: String): String = uploadFileId.split("/").headOption.getOrElse("")

  private def uploadDirectory(organizationName: String, uploadId: String): Path =
    dataBaseDir.resolve(organizationName).resolve(uploadingDir).resolve(uploadId)

  def getDataSourceIdByUploadId(uploadId: String): Fox[DataSourceId] =
    getObjectFromRedis[DataSourceId](redisKeyForDataSourceId(uploadId))

  def reserveUpload(reserveUploadInformation: ReserveUploadInformation): Fox[Unit] =
    for {
      _ <- runningUploadMetadataStore.insert(redisKeyForFileCount(reserveUploadInformation.uploadId),
                                             String.valueOf(reserveUploadInformation.totalFileCount))
      _ <- runningUploadMetadataStore.insert(
        redisKeyForDataSourceId(reserveUploadInformation.uploadId),
        Json.stringify(Json.toJson(DataSourceId(reserveUploadInformation.name, reserveUploadInformation.organization)))
      )
      _ <- runningUploadMetadataStore.insert(
        redisKeyForLinkedLayerIdentifier(reserveUploadInformation.uploadId),
        Json.stringify(Json.toJson(LinkedLayerIdentifiers(reserveUploadInformation.layersToLink)))
      )
      _ = logger.info(
        f"Reserving dataset upload of ${reserveUploadInformation.organization}/${reserveUploadInformation.name} with id ${reserveUploadInformation.uploadId}...")
    } yield ()

  private def isOutsideUploadDir(uploadDir: Path, filePath: String): Boolean =
    uploadDir.relativize(uploadDir.resolve(filePath)).startsWith("../")

  def handleUploadChunk(uploadFileId: String,
                        chunkSize: Long,
                        totalChunkCount: Long,
                        currentChunkNumber: Long,
                        chunkFile: File): Fox[Unit] = {
    val uploadId = extractDatasetUploadId(uploadFileId)
    for {
      dataSourceId <- getDataSourceIdByUploadId(uploadId)
      uploadDir = uploadDirectory(dataSourceId.team, uploadId)
      filePathRaw = uploadFileId.split("/").tail.mkString("/")
      filePath = if (filePathRaw.charAt(0) == '/') filePathRaw.drop(1) else filePathRaw
      _ <- bool2Fox(!isOutsideUploadDir(uploadDir, filePath)) ?~> s"Invalid file path: $filePath"
      isFileKnown <- runningUploadMetadataStore.contains(redisKeyForFileChunkCount(uploadId, filePath))
      _ <- Fox.runIf(!isFileKnown) {
        runningUploadMetadataStore
          .insertIntoSet(redisKeyForFileNameSet(uploadId), filePath)
          .flatMap(_ =>
            runningUploadMetadataStore.insert(redisKeyForFileChunkCount(uploadId, filePath),
                                              String.valueOf(totalChunkCount)))
      }
      isNewChunk <- runningUploadMetadataStore.insertIntoSet(redisKeyForFileChunkSet(uploadId, filePath),
                                                             String.valueOf(currentChunkNumber))
    } yield
      if (isNewChunk) {
        try {
          val bytes = Files.readAllBytes(chunkFile.toPath)
          this.synchronized {
            PathUtils.ensureDirectory(uploadDir.resolve(filePath).getParent)
            val tempFile = new RandomAccessFile(uploadDir.resolve(filePath).toFile, "rw")
            tempFile.seek((currentChunkNumber - 1) * chunkSize)
            tempFile.write(bytes)
            tempFile.close()
          }
          Fox.successful(())
        } catch {
          case e: Exception =>
            runningUploadMetadataStore.removeFromSet(redisKeyForFileChunkSet(uploadId, filePath),
                                                     String.valueOf(currentChunkNumber))
            val errorMsg = s"Error receiving chunk $currentChunkNumber for upload ${dataSourceId.name}: ${e.getMessage}"
            logger.warn(errorMsg)
            Fox.failure(errorMsg)
        }
      } else Fox.successful(())
  }

  def cancelUpload(cancelUploadInformation: CancelUploadInformation): Fox[Unit] = {
    val uploadId = cancelUploadInformation.uploadId
    for {
      dataSourceId <- getDataSourceIdByUploadId(uploadId)
      knownUpload <- isKnownUpload(uploadId)
    } yield
      if (knownUpload) {
        logger.info(f"Cancelling dataset upload of ${dataSourceId.team}/${dataSourceId.name} with id $uploadId...")
        removeFromRedis(uploadId).flatMap(_ =>
          PathUtils.deleteDirectoryRecursively(uploadDirectory(dataSourceId.team, uploadId)))
      } else {
        Fox.failure(s"Unknown upload")
      }
  }

  def finishUpload(uploadInformation: UploadInformation, checkCompletion: Boolean = true): Fox[(DataSourceId, Long)] = {
    val uploadId = uploadInformation.uploadId

    for {
      dataSourceId <- getDataSourceIdByUploadId(uploadId)
      datasetNeedsConversion = uploadInformation.needsConversion.getOrElse(false)
      uploadDir = uploadDirectory(dataSourceId.team, uploadId)
      unpackToDir = dataSourceDirFor(dataSourceId, datasetNeedsConversion)

      _ = logger.info(s"Finishing dataset upload of ${dataSourceId.team}/${dataSourceId.name} with id $uploadId...")
      _ <- Fox.runIf(checkCompletion)(ensureAllChunksUploaded(uploadId))
      _ <- ensureDirectoryBox(unpackToDir.getParent) ?~> "dataset.import.fileAccessDenied"
      unpackResult <- unpackDataset(uploadDir, unpackToDir).futureBox
      _ <- cleanUpUploadedDataset(uploadDir, uploadId)
      _ <- cleanUpOnFailure(unpackResult,
                            dataSourceId,
                            datasetNeedsConversion,
                            label = s"unpacking to dataset to $unpackToDir")
      linkedLayerInfo <- getObjectFromRedis[LinkedLayerIdentifiers](redisKeyForLinkedLayerIdentifier(uploadId))
      postProcessingResult <- postProcessUploadedDataSource(datasetNeedsConversion,
                                                            unpackToDir,
                                                            dataSourceId,
                                                            linkedLayerInfo.layersToLink).futureBox
      _ <- cleanUpOnFailure(postProcessingResult,
                            dataSourceId,
                            datasetNeedsConversion,
                            label = s"processing dataset at $unpackToDir")
      dataSource = dataSourceService.dataSourceFromFolder(unpackToDir, dataSourceId.team)
      _ <- dataSourceRepository.updateDataSource(dataSource)
      datasetSizeBytes <- tryo(FileUtils.sizeOfDirectoryAsBigInteger(new File(unpackToDir.toString)).longValue)
    } yield (dataSourceId, datasetSizeBytes)
  }

  private def postProcessUploadedDataSource(datasetNeedsConversion: Boolean,
                                            unpackToDir: Path,
                                            dataSourceId: DataSourceId,
                                            layersToLink: Option[List[LinkedLayerIdentifier]]): Fox[Unit] =
    if (datasetNeedsConversion)
      Fox.successful(())
    else {
      for {
        _ <- Fox.successful(())
        uploadedDataSourceType = guessTypeOfUploadedDataSource(unpackToDir)
        _ <- uploadedDataSourceType match {
          case UploadedDataSourceType.ZARR | UploadedDataSourceType.NEUROGLANCER_PRECOMPUTED |
              UploadedDataSourceType.N5_MULTISCALES | UploadedDataSourceType.N5_ARRAY =>
            exploreLocalDatasource(unpackToDir, dataSourceId, uploadedDataSourceType)
          case UploadedDataSourceType.EXPLORED => Fox.successful(())
          case UploadedDataSourceType.ZARR_MULTILAYER | UploadedDataSourceType.NEUROGLANCER_MULTILAYER |
              UploadedDataSourceType.N5_MULTILAYER =>
            tryExploringMultipleLayers(unpackToDir, dataSourceId, uploadedDataSourceType)
          case UploadedDataSourceType.WKW => addLayerAndResolutionDirIfMissing(unpackToDir).toFox
        }
        _ <- datasetSymlinkService.addSymlinksToOtherDatasetLayers(unpackToDir, layersToLink.getOrElse(List.empty))
        _ <- addLinkedLayersToDataSourceProperties(unpackToDir, dataSourceId.team, layersToLink.getOrElse(List.empty))
      } yield ()
    }

  private def exploreLocalDatasource(path: Path,
                                     dataSourceId: DataSourceId,
                                     typ: UploadedDataSourceType.Value): Fox[Unit] =
    for {
      _ <- Fox.runIf(typ == UploadedDataSourceType.ZARR)(
        addLayerAndResolutionDirIfMissing(path, FILENAME_DOT_ZARRAY).toFox)
      explored <- exploreLocalLayerService.exploreLocal(path, dataSourceId)
      _ <- exploreLocalLayerService.writeLocalDatasourceProperties(explored, path)
    } yield ()

  private def tryExploringMultipleLayers(path: Path,
                                         dataSourceId: DataSourceId,
                                         typ: UploadedDataSourceType.Value): Fox[Option[Path]] =
    for {
      layerDirs <- typ match {
        case UploadedDataSourceType.ZARR_MULTILAYER => getZarrLayerDirectories(path)
        case UploadedDataSourceType.NEUROGLANCER_MULTILAYER | UploadedDataSourceType.N5_MULTILAYER =>
          PathUtils.listDirectories(path, silent = false).toFox
      }
      dataSources <- Fox.combined(
        layerDirs
          .map(layerDir =>
            for {
              _ <- addLayerAndResolutionDirIfMissing(layerDir).toFox
              explored: DataSourceWithMagLocators <- exploreLocalLayerService
                .exploreLocal(path, dataSourceId, layerDir.getFileName.toString)
            } yield explored)
          .toList)
      combinedLayers = exploreLocalLayerService.makeLayerNamesUnique(dataSources.flatMap(_.dataLayers))
      dataSource = GenericDataSource[DataLayer](dataSourceId, combinedLayers, dataSources.head.scale)
      path <- Fox.runIf(combinedLayers.nonEmpty)(
        exploreLocalLayerService.writeLocalDatasourceProperties(dataSource, path))
    } yield path

  private def cleanUpOnFailure[T](result: Box[T],
                                  dataSourceId: DataSourceId,
                                  datasetNeedsConversion: Boolean,
                                  label: String): Fox[Unit] =
    result match {
      case Full(_) =>
        Fox.successful(())
      case Empty =>
        deleteOnDisk(dataSourceId.team, dataSourceId.name, datasetNeedsConversion, Some("the upload failed"))
        Fox.failure(s"Unknown error $label")
      case Failure(msg, e, _) =>
        logger.warn(s"Error while $label: $msg, $e")
        deleteOnDisk(dataSourceId.team, dataSourceId.name, datasetNeedsConversion, Some("the upload failed"))
        dataSourceRepository.cleanUpDataSource(dataSourceId)
        for {
          _ <- result ?~> f"Error while $label"
        } yield ()
    }

  private def ensureAllChunksUploaded(uploadId: String): Fox[Unit] =
    for {
      fileCountStringOpt <- runningUploadMetadataStore.find(redisKeyForFileCount(uploadId))
      fileCountString <- fileCountStringOpt ?~> "dataset.upload.noFiles"
      fileCount <- tryo(fileCountString.toLong).toFox
      fileNames <- runningUploadMetadataStore.findSet(redisKeyForFileNameSet(uploadId))
      _ <- bool2Fox(fileCount == fileNames.size)
      list <- Fox.serialCombined(fileNames.toList) { fileName =>
        val chunkCount =
          runningUploadMetadataStore
            .find(redisKeyForFileChunkCount(uploadId, fileName))
            .map(s => s.getOrElse("").toLong)
        val chunks = runningUploadMetadataStore.findSet(redisKeyForFileChunkSet(uploadId, fileName))
        chunks.flatMap(set => chunkCount.map(_ == set.size))
      }
      _ <- bool2Fox(list.forall(identity))
    } yield ()

  private def dataSourceDirFor(dataSourceId: DataSourceId, datasetNeedsConversion: Boolean): Path = {
    val dataSourceDir =
      if (datasetNeedsConversion)
        dataBaseDir.resolve(dataSourceId.team).resolve(forConversionDir).resolve(dataSourceId.name)
      else
        dataBaseDir.resolve(dataSourceId.team).resolve(dataSourceId.name)
    dataSourceDir
  }

  private def addLinkedLayersToDataSourceProperties(unpackToDir: Path,
                                                    organizationName: String,
                                                    layersToLink: List[LinkedLayerIdentifier]): Fox[Unit] =
    if (layersToLink.isEmpty) {
      Fox.successful(())
    } else {
      val dataSource = dataSourceService.dataSourceFromFolder(unpackToDir, organizationName)
      for {
        dataSourceUsable <- dataSource.toUsable.toFox ?~> "Uploaded dataset has no valid properties file, cannot link layers"
        layers <- Fox.serialCombined(layersToLink)(layerFromIdentifier)
        dataSourceWithLinkedLayers = dataSourceUsable.copy(dataLayers = dataSourceUsable.dataLayers ::: layers)
        _ <- dataSourceService.updateDataSource(dataSourceWithLinkedLayers, expectExisting = true) ?~> "Could not write combined properties file"
      } yield ()
    }

  private def layerFromIdentifier(layerIdentifier: LinkedLayerIdentifier): Fox[DataLayer] = {
    val dataSourcePath = layerIdentifier.pathIn(dataBaseDir).getParent
    val inboxDataSource = dataSourceService.dataSourceFromFolder(dataSourcePath, layerIdentifier.organizationName)
    for {
      usableDataSource <- inboxDataSource.toUsable.toFox ?~> "Layer to link is not in dataset with valid properties file."
      layer: DataLayer <- usableDataSource.getDataLayer(layerIdentifier.layerName).toFox
      newName = layerIdentifier.newLayerName.getOrElse(layerIdentifier.layerName)
      layerRenamed: DataLayer <- layer match {
        case l: WKWSegmentationLayer => Fox.successful(l.copy(name = newName))
        case l: WKWDataLayer         => Fox.successful(l.copy(name = newName))
        case _                       => Fox.failure("Unknown layer type for link")
      }
    } yield layerRenamed
  }

  private def guessTypeOfUploadedDataSource(dataSourceDir: Path): UploadedDataSourceType.Value =
    if (looksLikeZarrArray(dataSourceDir, maxDepth = 2).openOr(false)) {
      UploadedDataSourceType.ZARR
    } else if (looksLikeExploredDataSource(dataSourceDir).openOr(false)) {
      UploadedDataSourceType.EXPLORED
    } else if (looksLikeZarrArray(dataSourceDir, maxDepth = 3).openOr(false)) {
      UploadedDataSourceType.ZARR_MULTILAYER
    } else if (looksLikeNeuroglancerPrecomputed(dataSourceDir, 1).openOr(false)) {
      UploadedDataSourceType.NEUROGLANCER_PRECOMPUTED
    } else if (looksLikeNeuroglancerPrecomputed(dataSourceDir, 2).openOr(false)) {
      UploadedDataSourceType.NEUROGLANCER_MULTILAYER
    } else if (looksLikeN5Multilayer(dataSourceDir).openOr(false)) {
      UploadedDataSourceType.N5_MULTILAYER
    } else if (looksLikeN5MultiscalesLayer(dataSourceDir).openOr(false)) {
      UploadedDataSourceType.N5_MULTISCALES
    } else if (looksLikeN5Array(dataSourceDir).openOr(false)) {
      UploadedDataSourceType.N5_ARRAY
    } else {
      UploadedDataSourceType.WKW
    }

  private def containsMatchingFile(fileNames: List[String], dataSourceDir: Path, maxDepth: Int): Box[Boolean] =
    for {
      listing: Seq[Path] <- PathUtils.listFilesRecursive(dataSourceDir,
                                                         maxDepth = maxDepth,
                                                         silent = false,
                                                         filters = p => fileNames.contains(p.getFileName.toString))
    } yield listing.nonEmpty

  private def looksLikeZarrArray(dataSourceDir: Path, maxDepth: Int): Box[Boolean] =
    containsMatchingFile(List(FILENAME_DOT_ZARRAY, FILENAME_DOT_ZATTRS), dataSourceDir, maxDepth)

  private def looksLikeNeuroglancerPrecomputed(dataSourceDir: Path, maxDepth: Int): Box[Boolean] =
    containsMatchingFile(List(FILENAME_INFO), dataSourceDir, maxDepth)

  private def looksLikeN5MultiscalesLayer(dataSourceDir: Path): Box[Boolean] =
    for {
      attributesFiles <- PathUtils.listFilesRecursive(dataSourceDir,
                                                      silent = false,
                                                      maxDepth = 1,
                                                      filters = p => p.getFileName.toString == FILENAME_ATTRIBUTES_JSON)
      _ <- bool2Box(attributesFiles.nonEmpty)
      _ <- Json.parse(new String(Files.readAllBytes(attributesFiles.head))).validate[N5Metadata]
    } yield true

  private def looksLikeN5Multilayer(dataSourceDir: Path): Box[Boolean] =
    for {
      _ <- containsMatchingFile(List(FILENAME_ATTRIBUTES_JSON), dataSourceDir, 1) // root attributes.json
      directories <- PathUtils.listDirectories(dataSourceDir, silent = false)
      detectedLayerBoxes = directories.map(looksLikeN5MultiscalesLayer)
      _ <- bool2Box(detectedLayerBoxes.forall(_.openOr(false)))
    } yield true

  private def looksLikeN5Array(dataSourceDir: Path): Box[Boolean] =
    // Expected structure:
    // dataSourceDir
    //  - attributes.json (Root attributes, only contains N5 version)
    //  - dataset
    //     - scale dir
    //        - directories 0 to n
    //        - attributes.json (N5Header, dimension, compression,...)
    for {
      _ <- containsMatchingFile(List(FILENAME_ATTRIBUTES_JSON), dataSourceDir, 1) // root attributes.json
      datasetDir <- PathUtils.listDirectories(dataSourceDir, silent = false).map(_.headOption)
      scaleDirs <- datasetDir.map(PathUtils.listDirectories(_, silent = false)).getOrElse(Full(Seq.empty))
      _ <- bool2Box(scaleDirs.length == 1) // Must be 1, otherwise it is a multiscale dataset
      attributesFiles <- PathUtils.listFilesRecursive(scaleDirs.head,
                                                      silent = false,
                                                      maxDepth = 1,
                                                      filters = p => p.getFileName.toString == FILENAME_ATTRIBUTES_JSON)
      _ <- Json.parse(new String(Files.readAllBytes(attributesFiles.head))).validate[N5Header]
    } yield true

  private def looksLikeExploredDataSource(dataSourceDir: Path): Box[Boolean] =
    containsMatchingFile(List(FILENAME_DATASOURCE_PROPERTIES_JSON), dataSourceDir, 1)

  private def getZarrLayerDirectories(dataSourceDir: Path): Fox[Seq[Path]] =
    for {
      potentialLayers <- PathUtils.listDirectories(dataSourceDir, silent = false)
      layerDirs = potentialLayers.filter(p => looksLikeZarrArray(p, maxDepth = 2).isDefined)
    } yield layerDirs

  private def addLayerAndResolutionDirIfMissing(dataSourceDir: Path,
                                                headerFile: String = FILENAME_HEADER_WKW): Box[Unit] =
    if (Files.exists(dataSourceDir)) {
      for {
        listing: Seq[Path] <- PathUtils.listFilesRecursive(dataSourceDir,
                                                           maxDepth = 2,
                                                           silent = false,
                                                           filters = p => p.getFileName.toString == headerFile)
        listingRelative = listing.map(dataSourceDir.normalize().relativize(_))
        _ <- if (looksLikeMagDir(listingRelative)) {
          val targetDir = dataSourceDir.resolve("color").resolve("1")
          logger.info(s"Looks like mag dir. Moving to $targetDir")
          PathUtils.moveDirectoryViaTemp(dataSourceDir, targetDir)
        } else if (looksLikeLayerDir(listingRelative)) {
          val targetDir = dataSourceDir.resolve("color")
          logger.info(s"Looks like layer dir. Moving to $targetDir")
          PathUtils.moveDirectoryViaTemp(dataSourceDir, targetDir)
        } else Full(())
      } yield ()
    } else Full(())

  private def looksLikeMagDir(headerWkwPaths: Seq[Path]): Boolean =
    headerWkwPaths.headOption.exists { oneHeaderWkwPath =>
      pathDepth(oneHeaderWkwPath) == 0
    }

  private def pathDepth(path: Path) = path.toString.count(_ == '/')

  private def looksLikeLayerDir(headerWkwPaths: Seq[Path]): Boolean =
    headerWkwPaths.headOption.exists { oneHeaderWkwPath =>
      pathDepth(oneHeaderWkwPath) == 1
    }

  private def unpackDataset(uploadDir: Path, unpackToDir: Path): Fox[Unit] =
    for {
      shallowFileList <- PathUtils.listFiles(uploadDir, silent = false).toFox
      excludeFromPrefix = Category.values.map(_.toString).toList
      firstFile = shallowFileList.headOption
      _ <- if (shallowFileList.length == 1 && shallowFileList.headOption.exists(
                 _.toString.toLowerCase.endsWith(".zip"))) {
        firstFile.toFox.flatMap { file =>
          ZipIO.unzipToFolder(
            new File(file.toString),
            unpackToDir,
            includeHiddenFiles = false,
            hiddenFilesWhitelist = List(".zarray", ".zattrs"),
            truncateCommonPrefix = true,
            Some(excludeFromPrefix)
          )
        }.toFox.map(_ => ())
      } else {
        for {
          deepFileList: List[Path] <- PathUtils.listFilesRecursive(uploadDir, silent = false, maxDepth = 10).toFox
          commonPrefixPreliminary = PathUtils.commonPrefix(deepFileList)
          strippedPrefix = PathUtils.cutOffPathAtLastOccurrenceOf(commonPrefixPreliminary, excludeFromPrefix)
          commonPrefix = PathUtils.removeSingleFileNameFromPrefix(strippedPrefix,
                                                                  deepFileList.map(_.getFileName.toString))
          _ <- tryo(FileUtils.moveDirectory(new File(commonPrefix.toString), new File(unpackToDir.toString))) ?~> "dataset.upload.moveToTarget.failed"
        } yield ()
      }
    } yield ()

  private def cleanUpUploadedDataset(uploadDir: Path, uploadId: String): Fox[Unit] = {
    this.synchronized {
      PathUtils.deleteDirectoryRecursively(uploadDir)
    }
    removeFromRedis(uploadId)
  }

  private def removeFromRedis(uploadId: String): Fox[Unit] =
    for {
      fileNames <- runningUploadMetadataStore.findSet(redisKeyForFileNameSet(uploadId))
      _ <- Fox.serialCombined(fileNames.toList) { fileName =>
        runningUploadMetadataStore
          .remove(redisKeyForFileChunkCount(uploadId, fileName))
          .flatMap(_ => runningUploadMetadataStore.remove(redisKeyForFileChunkSet(uploadId, fileName)))
      }
      _ <- runningUploadMetadataStore.remove(redisKeyForFileCount(uploadId))
      _ <- runningUploadMetadataStore.remove(redisKeyForFileNameSet(uploadId))
    } yield ()

  private def cleanUpOrphanUploads(): Fox[Unit] =
    for {
      organizationDirs <- PathUtils.listDirectories(dataBaseDir, silent = false).toFox
      _ <- Fox.serialCombined(organizationDirs)(cleanUpOrphanUploadsForOrga)
    } yield ()

  private def cleanUpOrphanUploadsForOrga(organizationDir: Path): Fox[Unit] = {
    val orgaUploadingDir: Path = organizationDir.resolve(uploadingDir)
    if (!Files.exists(orgaUploadingDir))
      Fox.successful(())
    else {
      for {
        uploadDirs <- PathUtils.listDirectories(orgaUploadingDir, silent = false).toFox
        _ <- Fox.serialCombined(uploadDirs) { uploadDir =>
          isKnownUpload(uploadDir.getFileName.toString).map {
            case false =>
              val deleteResult = PathUtils.deleteDirectoryRecursively(uploadDir)
              if (deleteResult.isDefined) {
                logger.info(f"Deleted orphan dataset upload at $uploadDir")
              } else {
                logger.warn(f"Failed to delete orphan dataset upload at $uploadDir")
              }
            case true => ()
          }
        }
      } yield ()
    }
  }

  private def getObjectFromRedis[T: Reads](key: String): Fox[T] =
    for {
      objectStringOption <- runningUploadMetadataStore.find(key)
      obj <- objectStringOption.toFox.flatMap(o => Json.fromJson[T](Json.parse(o)).asOpt)
    } yield obj

}

object UploadedDataSourceType extends Enumeration {
  val ZARR, EXPLORED, ZARR_MULTILAYER, WKW, NEUROGLANCER_PRECOMPUTED, NEUROGLANCER_MULTILAYER, N5_MULTISCALES,
  N5_MULTILAYER, N5_ARRAY = Value
}
