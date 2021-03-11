package com.scalableminds.webknossos.datastore.services

import java.io.{File, RandomAccessFile}
import java.nio.file.{Files, Path}

import com.google.inject.Inject
import com.scalableminds.util.io.PathUtils.ensureDirectoryBox
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.DataSetDeleter
import com.scalableminds.webknossos.datastore.models.datasource._
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common._
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.FileUtils
import play.api.libs.json.{Json, OFormat}

import scala.collection.mutable
import scala.concurrent.ExecutionContext.Implicits.global

case class ResumableUploadInformation(chunkSize: Int, totalChunkCount: Long)

case class UploadInformation(uploadId: String,
                             organization: String,
                             name: String,
                             initialTeams: List[String],
                             needsConversion: Option[Boolean])
object UploadInformation {
  implicit val uploadInformationFormat: OFormat[UploadInformation] = Json.format[UploadInformation]
}

class UploadService @Inject()(dataSourceRepository: DataSourceRepository, dataSourceService: DataSourceService)
    extends LazyLogging
    with DataSetDeleter
    with FoxImplicits {

  val dataBaseDir: Path = dataSourceService.dataBaseDir
  private val uploadingDir: String = ".uploading"

  // structure: uploadId → (fileCount, fileName → (totalChunkCount, receivedChunkIndices))
  val allSavedChunkIds: mutable.HashMap[String, (Long, mutable.HashMap[String, (Long, mutable.HashSet[Int])])] =
    mutable.HashMap.empty

  cleanUpOrphanUploads()

  def isKnownUpload(uploadFileId: String): Boolean =
    allSavedChunkIds.synchronized(allSavedChunkIds.contains(extractDatasetUploadId(uploadFileId)))

  private def extractDatasetUploadId(uploadFileId: String): String = uploadFileId.split("/").headOption.getOrElse("")

  def uploadDirectory(organizationName: String, uploadId: String): Path =
    dataBaseDir.resolve(organizationName).resolve(uploadingDir).resolve(uploadId)

  def handleUploadChunk(uploadFileId: String,
                        datasourceId: DataSourceId,
                        resumableUploadInformation: ResumableUploadInformation,
                        currentChunkNumber: Int,
                        totalFileCount: Int,
                        chunkFile: File): Fox[Unit] = {
    val uploadId = extractDatasetUploadId(uploadFileId)
    val uploadDir = uploadDirectory(datasourceId.team, uploadId)
    val filePathRaw = uploadFileId.split("/").tail.mkString("/")
    val filePath = if (filePathRaw.charAt(0) == '/') filePathRaw.drop(1) else filePathRaw
    val isNewChunk = allSavedChunkIds.synchronized {
      allSavedChunkIds.get(uploadId) match {
        case Some((_, savedChunkIdsForUpload)) =>
          savedChunkIdsForUpload.get(filePath) match {
            case Some((_, set)) =>
              set.add(currentChunkNumber) // returns true if isNewChunk

            case None =>
              savedChunkIdsForUpload.put(
                filePath,
                (resumableUploadInformation.totalChunkCount, mutable.HashSet[Int](currentChunkNumber)))
              true // isNewChunk
          }
        case None =>
          val uploadChunksForUpload: mutable.HashMap[String, (Long, mutable.HashSet[Int])] = mutable.HashMap.empty
          uploadChunksForUpload.put(
            filePath,
            (resumableUploadInformation.totalChunkCount, mutable.HashSet[Int](currentChunkNumber)))
          allSavedChunkIds.put(uploadId, (totalFileCount, uploadChunksForUpload))
          true // isNewChunk
      }
    }
    if (isNewChunk) {
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
          allSavedChunkIds.synchronized {
            allSavedChunkIds(uploadId)._2(filePath)._2.remove(currentChunkNumber)
          }
          val errorMsg = s"Error receiving chunk $currentChunkNumber for upload ${datasourceId.name}: ${e.getMessage}"
          logger.warn(errorMsg)
          return Fox.failure(errorMsg)
      }
    }
    Fox.successful(())
  }

  def finishUpload(uploadInformation: UploadInformation,
                   checkCompletion: Boolean = true): Fox[(DataSourceId, List[String], Long)] = {
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
      _ = cleanUpUploadedDataset(uploadDir, uploadId)
      _ <- unpackResult match {
        case Full(_) =>
          if (datasetNeedsConversion)
            Fox.successful(())
          else
            dataSourceRepository.updateDataSource(
              dataSourceService.dataSourceFromFolder(unpackToDir, dataSourceId.team))
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
    } yield (dataSourceId, uploadInformation.initialTeams, dataSetSizeBytes)
  }

  private def ensureAllChunksUploaded(uploadId: String): Fox[Unit] =
    allSavedChunkIds.synchronized {
      allSavedChunkIds.get(uploadId) match {
        case Some((fileCountForUpload, savedChunkIdsForUpload)) =>
          val allFilesPresent = fileCountForUpload == savedChunkIdsForUpload.keySet.size
          val allFilesComplete = savedChunkIdsForUpload.forall { entry: (String, (Long, mutable.HashSet[Int])) =>
            val chunkNumber = entry._2._1
            val savedChunksSet = entry._2._2
            savedChunksSet.size == chunkNumber
          }
          for {
            _ <- bool2Fox(allFilesPresent) ?~> "dataSet.import.incomplete.missingFiles"
            _ <- bool2Fox(allFilesComplete) ?~> "dataSet.import.incomplete.missingChunks"
          } yield ()
        case None => Fox.failure("dataSet.import.incomplete")
      }
    }

  private def dataSourceDirFor(dataSourceId: DataSourceId, datasetNeedsConversion: Boolean): Path = {
    val dataSourceDir =
      if (datasetNeedsConversion)
        dataBaseDir.resolve(dataSourceId.team).resolve(".forConversion").resolve(dataSourceId.name)
      else
        dataBaseDir.resolve(dataSourceId.team).resolve(dataSourceId.name)
    dataSourceDir
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

  private def cleanUpUploadedDataset(uploadDir: Path, uploadId: String): Unit = {
    allSavedChunkIds.synchronized {
      allSavedChunkIds.remove(uploadId)
    }
    this.synchronized {
      PathUtils.deleteDirectoryRecursively(uploadDir)
    }
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
      _ = uploadDirs.foreach { uploadDir =>
        if (!isKnownUpload(uploadDir.getFileName.toString)) {
          val deleteResult = PathUtils.deleteDirectoryRecursively(uploadDir)
          if (deleteResult.isDefined) {
            logger.info(f"Deleted orphan dataset upload at $uploadDir")
          } else {
            logger.warn(f"Failed to delete orphan dataset upload at $uploadDir")
          }
        }
      }
    } yield ()
  }

}
