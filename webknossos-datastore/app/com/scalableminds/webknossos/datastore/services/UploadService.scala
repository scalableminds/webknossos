package com.scalableminds.webknossos.datastore.services

import java.io.{File, RandomAccessFile}
import java.nio.file.{Files, Path}
import com.google.inject.Inject
import com.scalableminds.util.io.PathUtils.ensureDirectoryBox
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataLayer, WKWSegmentationLayer}
import com.scalableminds.webknossos.datastore.helpers.{DataSetDeleter, DirectoryConstants}
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common._
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.FileUtils
import play.api.libs.json.{Json, OFormat, Reads}

import scala.concurrent.ExecutionContext.Implicits.global

case class ReserveUploadInformation(uploadId: String,
                                    name: String,
                                    organization: String,
                                    totalFileCount: Long,
                                    layersToLink: Option[List[LinkedLayerIdentifier]],
                                    initialTeams: List[String])
object ReserveUploadInformation {
  implicit val reserveUploadInformation: OFormat[ReserveUploadInformation] = Json.format[ReserveUploadInformation]
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
                              runningUploadMetadataStore: DataStoreRedisStore)
    extends LazyLogging
    with DataSetDeleter
    with DirectoryConstants
    with FoxImplicits {

  val dataBaseDir: Path = dataSourceService.dataBaseDir

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

  def isKnownUploadByFileId(uploadFileId: String): Fox[Boolean] = isKnownUpload(extractDatasetUploadId(uploadFileId))

  def isKnownUpload(uploadId: String): Fox[Boolean] =
    runningUploadMetadataStore.contains(redisKeyForFileCount(uploadId))

  private def extractDatasetUploadId(uploadFileId: String): String = uploadFileId.split("/").headOption.getOrElse("")

  def uploadDirectory(organizationName: String, uploadId: String): Path =
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

  def isOutsideUploadDir(uploadDir: Path, filePath: String): Boolean =
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
        logger.info(f"Cancelling dataset upload of ${dataSourceId.team}/${dataSourceId.name} with id ${uploadId}...")
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
      _ <- ensureDirectoryBox(unpackToDir.getParent) ?~> "dataSet.import.fileAccessDenied"
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
                            label = s"processing to dataset at $unpackToDir")
      dataSource = dataSourceService.dataSourceFromFolder(unpackToDir, dataSourceId.team)
      _ <- dataSourceRepository.updateDataSource(dataSource)
      dataSetSizeBytes <- tryo(FileUtils.sizeOfDirectoryAsBigInteger(new File(unpackToDir.toString)).longValue)
    } yield (dataSourceId, dataSetSizeBytes)
  }

  private def postProcessUploadedDataSource(datasetNeedsConversion: Boolean,
                                            unpackToDir: Path,
                                            dataSourceId: DataSourceId,
                                            layersToLink: Option[List[LinkedLayerIdentifier]]) =
    if (datasetNeedsConversion)
      Fox.successful(())
    else {
      for {
        _ <- tryo(addLayerAndResolutionDirIfMissing(unpackToDir)).toFox
        _ <- addSymlinksToOtherDatasetLayers(unpackToDir, layersToLink.getOrElse(List.empty))
        _ <- addLinkedLayersToDataSourceProperties(unpackToDir, dataSourceId.team, layersToLink.getOrElse(List.empty))
      } yield ()
    }

  private def cleanUpOnFailure[T](result: Box[T],
                                  dataSourceId: DataSourceId,
                                  dataSetNeedsConversion: Boolean,
                                  label: String): Fox[Unit] =
    result match {
      case Full(_) =>
        Fox.successful(())
      case Empty =>
        deleteOnDisk(dataSourceId.team, dataSourceId.name, dataSetNeedsConversion, Some("the upload failed"))
        Fox.failure(s"Unknown error $label")
      case Failure(msg, e, _) =>
        deleteOnDisk(dataSourceId.team, dataSourceId.name, dataSetNeedsConversion, Some("the upload failed"))
        dataSourceRepository.cleanUpDataSource(dataSourceId)
        val errorMsg = s"Error $label: $msg, $e"
        logger.warn(errorMsg)
        Fox.failure(errorMsg)
    }

  private def ensureAllChunksUploaded(uploadId: String): Fox[Unit] =
    for {
      fileCountString <- runningUploadMetadataStore.find(redisKeyForFileCount(uploadId))
      fileCount <- tryo(fileCountString.getOrElse("").toLong).toFox
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

  private def addSymlinksToOtherDatasetLayers(dataSetDir: Path, layersToLink: List[LinkedLayerIdentifier]): Fox[Unit] =
    Fox
      .serialCombined(layersToLink) { layerToLink =>
        val layerPath = layerToLink.pathIn(dataBaseDir)
        val newLayerPath = dataSetDir.resolve(layerToLink.newLayerName.getOrElse(layerToLink.layerName))
        for {
          _ <- bool2Fox(!Files.exists(newLayerPath)) ?~> s"Cannot symlink layer at $newLayerPath: a layer with this name already exists."
          _ <- bool2Fox(Files.exists(layerPath)) ?~> s"Cannot symlink to layer at $layerPath: The layer does not exist."
          _ <- tryo {
            Files.createSymbolicLink(newLayerPath, newLayerPath.getParent.relativize(layerPath))
          } ?~> s"Failed to create symlink at $newLayerPath."
        } yield ()
      }
      .map { _ =>
        ()
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
        _ <- dataSourceService.updateDataSource(dataSourceWithLinkedLayers)
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

  private def addLayerAndResolutionDirIfMissing(dataSourceDir: Path): Unit =
    if (Files.exists(dataSourceDir)) {
      for {
        listing: Seq[Path] <- PathUtils.listDirectories(dataSourceDir)
      } yield {
        if (looksLikeMagDir(listing)) {
          val targetDir = dataSourceDir.resolve("color").resolve("1")
          logger.info(s"Looks like mag dir. Moving to $targetDir")
          PathUtils.moveDirectoryViaTemp(dataSourceDir, targetDir)
        } else if (looksLikeLayerDir(listing)) {
          val targetDir = dataSourceDir.resolve("color")
          logger.info(s"Looks like layer dir. Moving to $targetDir")
          PathUtils.moveDirectoryViaTemp(dataSourceDir, targetDir)
        }
      }
    }

  private def looksLikeMagDir(children: Seq[Path]): Boolean = {
    val magDirChildRegex = """z(\d+)""".r
    children.nonEmpty && children.forall(path =>
      path.getFileName.toString match {
        case magDirChildRegex(_*) => true
        case _                    => false
    })
  }

  private def looksLikeLayerDir(children: Seq[Path]): Boolean = {
    val layerDirChildRegex = """(\d+)|(\d+-\d+-\d+)""".r
    children.nonEmpty && children.exists(path =>
      path.getFileName.toString match {
        case layerDirChildRegex(_*) => true
        case _                      => false
    })
  }

  private def unpackDataset(uploadDir: Path, unpackToDir: Path): Fox[Unit] =
    for {
      shallowFileList <- PathUtils.listFiles(uploadDir).toFox
      excludeFromPrefix = Category.values.map(_.toString).toList
      firstFile = shallowFileList.headOption
      _ <- if (shallowFileList.length == 1 && shallowFileList.headOption.exists(
                 _.toString.toLowerCase.endsWith(".zip"))) {
        firstFile.toFox.flatMap { file =>
          ZipIO.unzipToFolder(
            new File(file.toString),
            unpackToDir,
            includeHiddenFiles = false,
            truncateCommonPrefix = true,
            Some(excludeFromPrefix)
          )
        }.toFox.map(_ => ())
      } else {
        for {
          deepFileList: List[Path] <- PathUtils.listFilesRecursive(uploadDir, maxDepth = 10).toFox
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
      organizationDirs <- PathUtils.listDirectories(dataBaseDir).toFox
      _ <- Fox.serialCombined(organizationDirs)(cleanUpOrphanUploadsForOrga)
    } yield ()

  private def cleanUpOrphanUploadsForOrga(organizationDir: Path): Fox[Unit] = {
    val orgaUploadingDir: Path = organizationDir.resolve(uploadingDir)
    if (!Files.exists(orgaUploadingDir)) return Fox.successful(())
    for {
      uploadDirs <- PathUtils.listDirectories(orgaUploadingDir).toFox
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

  private def getObjectFromRedis[T: Reads](key: String): Fox[T] =
    for {
      objectStringOption <- runningUploadMetadataStore.find(key)
      obj <- objectStringOption.toFox.flatMap(o => Json.fromJson[T](Json.parse(o)).asOpt)
    } yield obj

}
