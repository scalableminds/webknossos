package com.scalableminds.webknossos.datastore.services

import java.io.{File, RandomAccessFile}
import java.nio.file.{Files, Path}

import com.google.inject.Inject
import com.scalableminds.util.io.PathUtils.ensureDirectoryBox
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataLayer, WKWSegmentationLayer}
import com.scalableminds.webknossos.datastore.helpers.DataSetDeleter
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common._
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.FileUtils
import play.api.libs.json.{Json, OFormat}

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

case class UploadInformation(uploadId: String,
                             name: String,
                             organization: String,
                             layersToLink: Option[List[LinkedLayerIdentifier]],
                             needsConversion: Option[Boolean])

object UploadInformation {
  implicit val jsonFormat: OFormat[UploadInformation] = Json.format[UploadInformation]
}

case class CancelUploadInformation(uploadId: String, name: String, organization: String)
object CancelUploadInformation {
  implicit val jsonFormat: OFormat[CancelUploadInformation] = Json.format[CancelUploadInformation]
}

class UploadService @Inject()(dataSourceRepository: DataSourceRepository,
                              dataSourceService: DataSourceService,
                              runningUploadMetadataStore: DataStoreRedisStore)
    extends LazyLogging
    with DataSetDeleter
    with FoxImplicits {

  val dataBaseDir: Path = dataSourceService.dataBaseDir
  private val uploadingDir: String = ".uploading"

  /* Redis stores different information for each upload, with different prefixes in the keys:
   *  uploadId -> fileCount
   *  uploadId -> set(fileName)
   *  uploadId#fileName -> totalChunkCount
   *  uploadId#fileName -> set(chunkIndices)
   * Note that Redis synchronizes all db accesses, so we do not need to do it
   */
  private def redisKeyForFileCount(uploadId: String): String =
    s"upload___${uploadId}___fileCount"
  private def redisKeyForFileNameSet(uploadId: String): String =
    s"upload___${uploadId}___fileNameSet"
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

  def reserveUpload(reserveUploadInformation: ReserveUploadInformation): Fox[Unit] =
    for {
      _ <- runningUploadMetadataStore.insert(redisKeyForFileCount(reserveUploadInformation.uploadId),
                                             String.valueOf(reserveUploadInformation.totalFileCount))
      _ = logger.info(
        f"Reserving dataset upload of ${reserveUploadInformation.organization}/${reserveUploadInformation.name} with id ${reserveUploadInformation.uploadId}...")
    } yield ()

  def isOutsideUploadDir(uploadDir: Path, filePath: String): Boolean =
    uploadDir.relativize(uploadDir.resolve(filePath)).startsWith("../")

  def handleUploadChunk(uploadFileId: String,
                        datasourceId: DataSourceId,
                        chunkSize: Long,
                        totalChunkCount: Long,
                        currentChunkNumber: Long,
                        chunkFile: File): Fox[Unit] = {
    val uploadId = extractDatasetUploadId(uploadFileId)
    val uploadDir = uploadDirectory(datasourceId.team, uploadId)
    val filePathRaw = uploadFileId.split("/").tail.mkString("/")
    val filePath = if (filePathRaw.charAt(0) == '/') filePathRaw.drop(1) else filePathRaw

    if (isOutsideUploadDir(uploadDir, filePath)) return Fox.failure(s"Invalid file path: $filePath")

    val isNewChunk = for {
      isFileKnown <- runningUploadMetadataStore.contains(redisKeyForFileChunkCount(uploadId, filePath))
      _ <- if (isFileKnown) Fox.successful(())
      else {
        runningUploadMetadataStore
          .insertIntoSet(redisKeyForFileNameSet(uploadId), filePath)
          .flatMap(
            _ =>
              runningUploadMetadataStore.insert(redisKeyForFileChunkCount(uploadId, filePath),
                                                String.valueOf(totalChunkCount)))
      }
      isNewChunk <- runningUploadMetadataStore.insertIntoSet(redisKeyForFileChunkSet(uploadId, filePath),
                                                             String.valueOf(currentChunkNumber))
    } yield isNewChunk

    isNewChunk map {
      case true =>
        try {
          val bytes = Files.readAllBytes(chunkFile.toPath)
          this.synchronized {
            PathUtils.ensureDirectory(uploadDir.resolve(filePath).getParent)
            val tempFile = new RandomAccessFile(uploadDir.resolve(filePath).toFile, "rw")
            tempFile.seek((currentChunkNumber - 1) * chunkSize)
            tempFile.write(bytes)
            tempFile.close()
          }
        } catch {
          case e: Exception =>
            runningUploadMetadataStore.removeFromSet(redisKeyForFileChunkSet(uploadId, filePath),
                                                     String.valueOf(currentChunkNumber))
            val errorMsg = s"Error receiving chunk $currentChunkNumber for upload ${datasourceId.name}: ${e.getMessage}"
            logger.warn(errorMsg)
            return Fox.failure(errorMsg)
        }
      case false => ()
    }
  }

  def cancelUpload(cancelUploadInformation: CancelUploadInformation): Fox[Unit] = {
    val uploadId = cancelUploadInformation.uploadId
    runningUploadMetadataStore.contains(redisKeyForFileCount(uploadId)).flatMap {
      case false => Fox.failure(s"Unknown upload")
      case true =>
        logger.info(
          f"Canceling dataset upload of ${cancelUploadInformation.organization}/${cancelUploadInformation.name} with id ${uploadId}...")
        PathUtils.deleteDirectoryRecursively(uploadDirectory(cancelUploadInformation.organization, uploadId))
        cleanUpRedis(uploadId)
    }
  }

  def finishUpload(uploadInformation: UploadInformation, checkCompletion: Boolean = true): Fox[(DataSourceId, Long)] = {
    val uploadId = uploadInformation.uploadId
    val dataSourceId = DataSourceId(uploadInformation.name, uploadInformation.organization)
    val datasetNeedsConversion = uploadInformation.needsConversion.getOrElse(false)
    val uploadDir = uploadDirectory(uploadInformation.organization, uploadId)
    val unpackToDir = dataSourceDirFor(dataSourceId, datasetNeedsConversion)

    logger.info(
      s"Finishing dataset upload of ${uploadInformation.organization}/${uploadInformation.name} with id $uploadId...")

    for {
      _ <- Fox.runIf(checkCompletion)(ensureAllChunksUploaded(uploadId))
      _ <- ensureDirectoryBox(unpackToDir.getParent) ?~> "dataSet.import.fileAccessDenied"
      unpackResult <- unpackDataset(uploadDir, unpackToDir).futureBox
      _ <- cleanUpUploadedDataset(uploadDir, uploadId)
      _ <- cleanUpOnFailure(unpackResult,
                            dataSourceId,
                            datasetNeedsConversion,
                            label = s"unpacking to dataset to $unpackToDir")
      postProcessingResult <- postProcessUploadedDataSource(datasetNeedsConversion, unpackToDir, uploadInformation).futureBox
      _ <- cleanUpOnFailure(postProcessingResult,
                            dataSourceId,
                            datasetNeedsConversion,
                            label = s"processing to dataset at $unpackToDir")
      dataSource = dataSourceService.dataSourceFromFolder(unpackToDir, uploadInformation.organization)
      _ <- dataSourceRepository.updateDataSource(dataSource)
      dataSetSizeBytes <- tryo(FileUtils.sizeOfDirectoryAsBigInteger(new File(unpackToDir.toString)).longValue)
    } yield (dataSourceId, dataSetSizeBytes)
  }

  private def postProcessUploadedDataSource(datasetNeedsConversion: Boolean,
                                            unpackToDir: Path,
                                            uploadInformation: UploadInformation) =
    if (datasetNeedsConversion)
      Fox.successful(())
    else {
      for {
        _ <- tryo(addLayerAndResolutionDirIfMissing(unpackToDir)).toFox
        _ <- addSymlinksToOtherDatasetLayers(unpackToDir, uploadInformation.layersToLink.getOrElse(List.empty))
        _ <- addLinkedLayersToDataSourceProperties(unpackToDir,
                                                   uploadInformation.organization,
                                                   uploadInformation.layersToLink.getOrElse(List.empty))
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
        dataBaseDir.resolve(dataSourceId.team).resolve(".forConversion").resolve(dataSourceId.name)
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
    cleanUpRedis(uploadId)
  }

  private def cleanUpRedis(uploadId: String): Fox[Unit] =
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

}
