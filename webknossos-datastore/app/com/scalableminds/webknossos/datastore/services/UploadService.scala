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

import scala.collection.mutable
import scala.concurrent.ExecutionContext.Implicits.global

case class ResumableUploadInformation(chunkSize: Int, totalChunkCount: Long)

case class ReserveUploadInformation(uploadId: String,
                                    name: String,
                                    organization: String,
                                    totalFileCount: Int,
                                    initialTeams: List[String])
object ReserveUploadInformation {
  implicit val reserveUploadInformation: OFormat[ReserveUploadInformation] = Json.format[ReserveUploadInformation]
}

case class UploadInformation(uploadId: String, name: String, organization: String, needsConversion: Option[Boolean])
object UploadInformation {
  implicit val uploadInformationFormat: OFormat[UploadInformation] = Json.format[UploadInformation]
}

class UploadService @Inject()(dataSourceRepository: DataSourceRepository,
                              dataSourceService: DataSourceService,
                              chunkStore: DataStoreRedisStore)
    extends LazyLogging
    with DataSetDeleter
    with FoxImplicits {

  val dataBaseDir: Path = dataSourceService.dataBaseDir
  private val uploadingDir: String = ".uploading"

  // structure: uploadId → (fileCount, fileName → (totalChunkCount, receivedChunkIndices))
  val allSavedChunkIds: mutable.HashMap[String, (Long, mutable.HashMap[String, (Long, mutable.HashSet[Int])])] =
    mutable.HashMap.empty

  // redis structure: uploadId -> fileCount, uploadId -> set(fileName), uploadId#fileName -> totalChunkCount, uploadId#fileName -> set(chunkIndices)
  // redis synchronizes all db accesses, so we do not need to do it anymore
  def uploadKey(uploadId: String, typeString: String): String = s"upload___${uploadId}___$typeString"
  def uploadFileKey(uploadId: String, fileName: String, typeString: String): String =
    s"uploadFile___${uploadId}___${fileName}___$typeString"
  val setType: String = "set"
  val stringType: String = "string"

  cleanUpOrphanUploads()

  def isKnownFileUpload(uploadFileId: String): Fox[Boolean] = isKnownUpload(extractDatasetUploadId(uploadFileId))

  def isKnownUpload(uploadId: String): Fox[Boolean] =
    chunkStore.contains(uploadKey(uploadId, stringType))

  private def extractDatasetUploadId(uploadFileId: String): String = uploadFileId.split("/").headOption.getOrElse("")

  def uploadDirectory(organizationName: String, uploadId: String): Path =
    dataBaseDir.resolve(organizationName).resolve(uploadingDir).resolve(uploadId)

  def reserveUpload(reserveUploadInformation: ReserveUploadInformation): Fox[Unit] =
    for {
      _ <- chunkStore.insert(uploadKey(reserveUploadInformation.uploadId, stringType),
                             String.valueOf(reserveUploadInformation.totalFileCount))
    } yield ()

  def handleUploadChunk(uploadFileId: String,
                        datasourceId: DataSourceId,
                        resumableUploadInformation: ResumableUploadInformation,
                        currentChunkNumber: Int,
                        chunkFile: File): Fox[Unit] = {
    val uploadId = extractDatasetUploadId(uploadFileId)
    val uploadDir = uploadDirectory(datasourceId.team, uploadId)
    val filePathRaw = uploadFileId.split("/").tail.mkString("/")
    val filePath = if (filePathRaw.charAt(0) == '/') filePathRaw.drop(1) else filePathRaw

    val isNewChunk = for {
      isFileKnown <- chunkStore.contains(uploadFileKey(uploadId, filePath, stringType))
      _ <- if (isFileKnown) Fox.successful(())
      else {
        chunkStore
          .insert_into_set(uploadKey(uploadId, setType), filePath)
          .flatMap(
            _ =>
              chunkStore.insert(uploadFileKey(uploadId, filePath, stringType),
                                String.valueOf(resumableUploadInformation.totalChunkCount)))
      }
      isNewChunk <- chunkStore.insert_into_set(uploadFileKey(uploadId, filePath, setType),
                                               String.valueOf(currentChunkNumber))
    } yield isNewChunk
    isNewChunk map {
      case true =>
        try {
          val bytes = Files.readAllBytes(chunkFile.toPath)
          this.synchronized {
            PathUtils.ensureDirectory(uploadDir.resolve(filePath).getParent)
            val tempFile = new RandomAccessFile(uploadDir.resolve(filePath).toFile, "rw")
            tempFile.seek((currentChunkNumber - 1) * resumableUploadInformation.chunkSize)
            tempFile.write(bytes)
            tempFile.close()
          }
        } catch {
          case e: Exception =>
            chunkStore.remove_from_set(uploadFileKey(uploadId, filePath, setType), String.valueOf(currentChunkNumber))
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
      fileCountString <- chunkStore.find(uploadKey(uploadId, stringType))
      fileCount <- tryo(Integer.parseInt(fileCountString.getOrElse(""))).toFox
      fileNames <- chunkStore.find_set(uploadKey(uploadId, setType))
      _ <- bool2Fox(fileCount == fileNames.size)
      list <- Fox.serialCombined(fileNames.toList) { fileName =>
        val chunkCount =
          chunkStore.find(uploadFileKey(uploadId, fileName, stringType)).map(s => Integer.valueOf(s.getOrElse("")))
        val chunks = chunkStore.find_set(uploadFileKey(uploadId, fileName, setType))
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
      fileNames <- chunkStore.find_set(uploadKey(uploadId, setType))
      _ <- Fox.serialCombined(fileNames.toList) { fileName =>
        chunkStore
          .remove(uploadFileKey(uploadId, fileName, stringType))
          .flatMap(_ => chunkStore.remove(uploadFileKey(uploadId, fileName, setType)))
      }
      _ <- chunkStore.remove(uploadKey(uploadId, stringType))
      _ <- chunkStore.remove(uploadKey(uploadId, setType))
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
          case true => {
            val deleteResult = PathUtils.deleteDirectoryRecursively(uploadDir)
            if (deleteResult.isDefined) {
              logger.info(f"Deleted orphan dataset upload at $uploadDir")
            } else {
              logger.warn(f"Failed to delete orphan dataset upload at $uploadDir")
            }
          }
          case false => ()
        }
      }
    } yield ()
  }

}
