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
import net.liftweb.util.Helpers.tryo
import net.liftweb.common._
import org.apache.commons.io.FileUtils
import play.api.libs.json.{Json, OFormat}

import scala.collection.mutable
import scala.concurrent.ExecutionContext.Implicits.global
import scala.reflect.io.Directory

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

  // structure: uploadId → (fileName → (totalChunkCount, receivedChunkIndices))
  val allSavedChunkIds: mutable.HashMap[String, mutable.HashMap[String, (Long, mutable.HashSet[Int])]] =
    mutable.HashMap.empty

  cleanUpOrphanFileChunks()

  def isKnownUpload(uploadId: String): Boolean = allSavedChunkIds.synchronized(allSavedChunkIds.contains(uploadId))

  private def uploadDirectory(organizationName: String, uploadId: String): Path =
    dataBaseDir.resolve(organizationName).resolve(".uploading").resolve(uploadId)

  def handleUploadChunk(uploadFileId: String,
                        datasourceId: DataSourceId,
                        resumableUploadInformation: ResumableUploadInformation,
                        currentChunkNumber: Int,
                        chunkFile: File): Fox[Unit] = {
    val uploadId = uploadFileId.split("/").headOption.getOrElse("")
    val uploadDir = uploadDirectory(datasourceId.team, uploadId)
    val filePath = uploadFileId.split("/").tail.mkString("/")
    logger.info(
      s"handleUploadChunk uploadId $uploadFileId ${datasourceId.name}, currentChunkNumber $currentChunkNumber")
    val isNewChunk = allSavedChunkIds.synchronized {
      allSavedChunkIds.get(uploadId) match {
        case Some(savedChunkIdsForUpload) =>
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
          allSavedChunkIds.put(uploadId, uploadChunksForUpload)
          true // isNewChunk
      }
    }
    if (isNewChunk) {
      try {
        val bytes = Files.readAllBytes(chunkFile.toPath)
        this.synchronized {
          makedirs(uploadDir.resolve(filePath).getParent)
          val tempFile = new RandomAccessFile(uploadDir.resolve(filePath).toFile, "rw")
          tempFile.seek((currentChunkNumber - 1) * resumableUploadInformation.chunkSize)
          tempFile.write(bytes)
          tempFile.close()
        }
      } catch {
        case e: Exception =>
          allSavedChunkIds.synchronized {
            allSavedChunkIds(uploadId)(filePath)._2.remove(currentChunkNumber)
          }
          val errorMsg = s"Error receiving chunk $currentChunkNumber for upload ${datasourceId.name}: ${e.getMessage}"
          logger.warn(errorMsg)
          return Fox.failure(errorMsg)
      }
    }
    Fox.successful(())
  }

  private def makedirs(path: Path): Boolean =
    new File(path.toString).mkdirs()

  def finishUpload(uploadInformation: UploadInformation): Fox[(DataSourceId, List[String])] = {
    val uploadId = uploadInformation.uploadId
    val dataSourceId = DataSourceId(uploadInformation.name, uploadInformation.organization)
    val datasetNeedsConversion = uploadInformation.needsConversion.getOrElse(false)
    val uploadDir = uploadDirectory(uploadInformation.organization, uploadId)
    val unpackToDir = dataSourceDirFor(dataSourceId, datasetNeedsConversion)

    logger.info(s"finishUpload, uploadId $uploadId")

    for {
      _ <- ensureAllChunksUploaded(uploadId)
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
          Fox.failure("dataset upload unknown error")
        case Failure(msg, e, _) =>
          deleteOnDisk(dataSourceId.team, dataSourceId.name, datasetNeedsConversion, Some("the upload failed"))
          dataSourceRepository.cleanUpDataSource(dataSourceId)
          val errorMsg = s"Error unzipping uploaded dataset to $unpackToDir: $msg, $e"
          logger.warn(errorMsg)
          Fox.failure(errorMsg)
      }
    } yield (dataSourceId, uploadInformation.initialTeams)
  }

  private def ensureAllChunksUploaded(uploadId: String): Fox[Unit] =
    allSavedChunkIds.synchronized {
      allSavedChunkIds.get(uploadId) match {
        case Some(savedChunkIdsForUpload) =>
          val allUploaded = savedChunkIdsForUpload.forall { entry: (String, (Long, mutable.HashSet[Int])) =>
            val chunkNumber = entry._2._1
            val savedChunksSet = entry._2._2
            savedChunksSet.size == chunkNumber
          }
          bool2Fox(allUploaded) ?~> "dataSet.import.incomplete"
        case None => Fox.failure("dataSet.import.incomplete")
      }
    }

  private def dataSourceDirFor(dataSourceId: DataSourceId, datasetNeedsConversion: Boolean): Path = {
    val dataSourceDir =
      if (datasetNeedsConversion)
        dataBaseDir.resolve(dataSourceId.team).resolve(".forConversion").resolve(dataSourceId.name)
      else
        dataBaseDir.resolve(dataSourceId.team).resolve(dataSourceId.name)
    logger.info(s"Unpacking dataset to $dataSourceDir")
    dataSourceDir
  }

  private def unpackDataset(uploadDir: Path, unpackToDir: Path): Fox[Unit] = {
    val uploadDirectory = new Directory(new File(uploadDir.toString))
    val shallowFileList = uploadDirectory.list.toList
    val shallowFileCount = shallowFileList.length
    val excludeFromPrefix = Category.values.map(_.toString).toList
    if (shallowFileCount == 1 && shallowFileList.headOption.exists(_.path.toLowerCase().endsWith(".zip"))) {
      shallowFileList.headOption.map { file =>
        ZipIO
          .unzipToFolder(
            new File(file.toString()),
            unpackToDir,
            includeHiddenFiles = false,
            truncateCommonPrefix = true,
            Some(excludeFromPrefix)
          )
          .toFox
          .map(_ => ())
      }.getOrElse(Fox.successful(()))
    } else {
      for {
        deepFileList: List[Path] <- PathUtils.listFilesRecursive(uploadDir, maxDepth = 10).toFox
        commonPrefixPreliminary = PathUtils.commonPrefix(deepFileList)
        strippedPrefix = PathUtils.cutOffPathAtLastOccurrenceOf(commonPrefixPreliminary, excludeFromPrefix)
        commonPrefix = PathUtils.removeSingleFileNameFromPrefix(strippedPrefix,
                                                                deepFileList.map(_.getFileName.toString))
        _ <- tryo(FileUtils.moveDirectory(new File(commonPrefix.toString), new File(unpackToDir.toString)))
      } yield ()
    }
  }

  private def cleanUpUploadedDataset(uploadDir: Path, uploadId: String): Unit = {
    allSavedChunkIds.synchronized {
      allSavedChunkIds.remove(uploadId)
    }
    this.synchronized {
      val directory = new Directory(new File(uploadDir.toString))
      if (directory.exists)
        directory.deleteRecursively()
      ()
    }
  }

  def cleanUpOrphanFileChunks(): Box[Unit] =
    PathUtils
      .listFiles(dataBaseDir, PathUtils.fileExtensionFilter("temp"))
      .map { tempUploadFiles =>
        val uploadIds = tempUploadFiles.map { uploadFile =>
          // file name format is .${uploadId}.temp
          val uploadId = uploadFile.getFileName.toString.drop(1).dropRight(5)
          if (!isKnownUpload(uploadId)) {
            try {
              uploadFile.toFile.delete()
            } catch {
              case _: Exception => println(s"Could not delete file $uploadId")
            }
          }
          uploadId
        }.mkString(", ")
        if (uploadIds != "") println(s"Deleted the following $uploadIds")
      }
      .map(_ => ())
}
