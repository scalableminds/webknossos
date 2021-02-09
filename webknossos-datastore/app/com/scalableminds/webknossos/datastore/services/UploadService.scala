package com.scalableminds.webknossos.datastore.services

import java.io.{File, RandomAccessFile}
import java.nio.file.{Files, Path, Paths}

import com.google.inject.Inject
import com.scalableminds.util.io.PathUtils.ensureDirectoryBox
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.DataSetDeleter
import com.scalableminds.webknossos.datastore.models.datasource._
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common._
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

  // structure: uploadId → (fileName → (totalChunkCount, receivedChunkIndices))
  val allSavedChunkIds: mutable.HashMap[String, mutable.HashMap[String, (Long, mutable.HashSet[Int])]] = mutable.HashMap.empty

  cleanUpOrphanFileChunks()

  def isKnownUpload(uploadId: String): Boolean = allSavedChunkIds.synchronized(allSavedChunkIds.contains(uploadId))

  private def uploadDirectory(organizationName: String, uploadId: String): String =
    dataBaseDir.resolve(organizationName).resolve(".uploading").resolve(uploadId).toString

  def handleUploadChunk(uploadFileId: String,
                        datasourceId: DataSourceId,
                        resumableUploadInformation: ResumableUploadInformation,
                        currentChunkNumber: Int,
                        chunkFile: File): Fox[Unit] = {
    val uploadId = uploadFileId.split("/").headOption.getOrElse("dummy")
    val uploadDir = uploadDirectory(datasourceId.team, uploadId)
    val fileName = uploadFileId.split("/").tail.headOption.getOrElse("aFile")
    logger.info(s"handleUploadChunk uploadId $uploadFileId ${datasourceId.name}, currentChunkNumber $currentChunkNumber")
    val isNewChunk = allSavedChunkIds.synchronized {
      allSavedChunkIds.get(uploadId) match {
        case Some(savedChunkIdsForUpload) =>
          savedChunkIdsForUpload.get(fileName) match {
            case Some((_, set)) =>
              set.add(currentChunkNumber)  // returns true if isNewChunk

            case None =>
              savedChunkIdsForUpload.put(fileName,
                (resumableUploadInformation.totalChunkCount, mutable.HashSet[Int](currentChunkNumber)))
              true // isNewChunk
          }
        case None =>
          val uploadChunksForUpload: mutable.HashMap[String, (Long, mutable.HashSet[Int])] = mutable.HashMap.empty
          uploadChunksForUpload.put(fileName,
            (resumableUploadInformation.totalChunkCount, mutable.HashSet[Int](currentChunkNumber)))
          allSavedChunkIds.put(uploadId, uploadChunksForUpload)
          true // isNewChunk
      }
    }
    if (isNewChunk) {
      try {
        val bytes = Files.readAllBytes(chunkFile.toPath)
        this.synchronized {
          new File(uploadDir).mkdirs()
          val tempFile = new RandomAccessFile(Paths.get(uploadDir).resolve(fileName).toFile, "rw")
          tempFile.seek((currentChunkNumber - 1) * resumableUploadInformation.chunkSize)
          tempFile.write(bytes)
          tempFile.close()
        }
      } catch {
        case e: Exception =>
          allSavedChunkIds.synchronized {
            allSavedChunkIds(uploadId)(fileName)._2.remove(currentChunkNumber)
          }
          val errorMsg = s"Error receiving chunk $currentChunkNumber for upload ${datasourceId.name}: ${e.getMessage}"
          logger.warn(errorMsg)
          return Fox.failure(errorMsg)
      }
    }
    Fox.successful(())
  }

  def finishUpload(uploadInformation: UploadInformation): Fox[(DataSourceId, List[String])] = {
    val uploadId = uploadInformation.uploadId
    logger.info(s"finishUpload, uploadId $uploadId")
    val dataSourceId = DataSourceId(uploadInformation.name, uploadInformation.organization)
    val datasetNeedsConversion = uploadInformation.needsConversion.getOrElse(false)
    val uploadDir = uploadDirectory(uploadInformation.organization, uploadId)
    val zipFile = dataBaseDir.resolve(s".$uploadId.temp").toFile
    val unpackToDir = dataSourceDirFor(dataSourceId, datasetNeedsConversion)

    for {
      _ <- allSavedChunkIds.synchronized { ensureAllChunksUploaded(uploadId) }
      _ <- ensureDirectoryBox(unpackToDir) ?~> "dataSet.import.fileAccessDenied"
      unzipResult = this.synchronized {
        ZipIO.unzipToFolder(
          zipFile,
          unpackToDir,
          includeHiddenFiles = false,
          truncateCommonPrefix = true,
          Some(Category.values.map(_.toString).toList)
        )
      }
      _ = allSavedChunkIds.synchronized { allSavedChunkIds.remove(uploadId) }
      _ = this.synchronized { zipFile.delete() }
      _ <- unzipResult match {
        case Full(_) =>
          if (datasetNeedsConversion)
            Fox.successful(())
          else
            dataSourceRepository.updateDataSource(
              dataSourceService.dataSourceFromFolder(unpackToDir, dataSourceId.team))
        case e =>
          deleteOnDisk(dataSourceId.team, dataSourceId.name, datasetNeedsConversion, Some("the upload failed"))
          dataSourceRepository.cleanUpDataSource(dataSourceId)
          val errorMsg = s"Error unzipping uploaded dataset to $unpackToDir: $e"
          logger.warn(errorMsg)
          Fox.failure(errorMsg)
      }
    } yield (dataSourceId, uploadInformation.initialTeams)
  }

  private def ensureAllChunksUploaded(uploadId: String): Fox[Unit] = allSavedChunkIds.get(uploadId) match {
    case Some(savedChunkIdsForUpload) =>
      val allUploaded = savedChunkIdsForUpload.forall{ entry: (String, (Long, mutable.HashSet[Int])) =>
        val chunkNumber = entry._2._1
        val savedChunksSet = entry._2._2
        savedChunksSet.size != chunkNumber
      }
      bool2Fox(allUploaded) ?~> "dataSet.import.incomplete"
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
