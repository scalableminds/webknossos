package com.scalableminds.webknossos.datastore.services

import java.io.{File, RandomAccessFile}
import java.nio.file.{Files, Path}

import com.google.inject.Inject
import com.scalableminds.util.io.PathUtils.ensureDirectoryBox
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
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
                                    initialTeams: List[String])
object ReserveUploadInformation {
  implicit val reserveUploadInformation: OFormat[ReserveUploadInformation] = Json.format[ReserveUploadInformation]
}

case class LayerIdentifier(organizationName: String, dataSetName: String, layerName: String)

object LayerIdentifier {
  implicit val jsonFormat: OFormat[LayerIdentifier] = Json.format[LayerIdentifier]
}

case class UploadInformation(uploadId: String,
                             name: String,
                             organization: String,
                             layersToLink: List[LayerIdentifier],
                             needsConversion: Option[Boolean])

object UploadInformation {
  implicit val jsonFormat: OFormat[UploadInformation] = Json.format[UploadInformation]
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
   *  uploadId -> set(fileName),
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
      _ <- unpackResult match {
        case Full(_) =>
          if (datasetNeedsConversion)
            Fox.successful(())
          else {
            addLayerAndResolutionDirIfMissing(unpackToDir)
            addSymlinksToOtherDatasetLayers(unpackToDir, uploadInformation.layersToLink)
            dataSourceRepository.updateDataSource(
              dataSourceService.dataSourceFromFolder(unpackToDir, dataSourceId.team))
          }
        case Empty =>
          Fox.failure(s"Unknown error while unpacking dataset ${dataSourceId.name}")
          deleteOnDisk(dataSourceId.team, dataSourceId.name, datasetNeedsConversion, Some("the upload failed"))
        case Failure(msg, e, _) =>
          deleteOnDisk(dataSourceId.team, dataSourceId.name, datasetNeedsConversion, Some("the upload failed"))
          dataSourceRepository.cleanUpDataSource(dataSourceId)
          val errorMsg = s"Error unzipping uploaded dataset to $unpackToDir: $msg, $e"
          logger.warn(errorMsg)
          Fox.failure(errorMsg)
      }
      dataSetSizeBytes <- tryo(FileUtils.sizeOfDirectoryAsBigInteger(new File(unpackToDir.toString)).longValue)
    } yield (dataSourceId, dataSetSizeBytes)
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

  private def addSymlinksToOtherDatasetLayers(dataSetDir: Path, linkedLayers: List[LayerIdentifier]): Unit =
    linkedLayers.foreach { linkedLayer =>
      val layerPath = dataBaseDir
        .resolve(linkedLayer.organizationName)
        .resolve(linkedLayer.dataSetName)
        .resolve(linkedLayer.layerName)
      val newLayerPath = dataSetDir.resolve(linkedLayer.layerName)
      if (Files.exists(newLayerPath)) {
        logger.warn(s"Cannot symlink layer at $newLayerPath: a layer with this name already exists.")
      } else if (Files.exists(layerPath)) {
        logger.info(s"Creating layer symlink pointing to $layerPath")
        Files.createSymbolicLink(newLayerPath, newLayerPath.getParent.relativize(layerPath))
      }
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
  }

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
