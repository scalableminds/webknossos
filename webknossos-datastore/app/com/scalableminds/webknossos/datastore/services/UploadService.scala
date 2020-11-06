package com.scalableminds.webknossos.datastore.services

import java.io.{File, RandomAccessFile}
import java.nio.file.{AccessDeniedException, Files, Path}

import com.google.inject.Inject
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
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
    with FoxImplicits {

  val dataBaseDir: Path = dataSourceService.dataBaseDir

  val savedUploadChunks: mutable.HashMap[String, (Long, mutable.HashSet[Int])] = mutable.HashMap.empty

  def isKnownUpload(uploadId: String): Boolean = savedUploadChunks.contains(uploadId)

  def handleUploadChunk(uploadId: String,
                        datasourceId: DataSourceId,
                        resumableUploadInformation: ResumableUploadInformation,
                        currentChunkNumber: Int,
                        chunkFile: File): Fox[Unit] = {
    val isChunkNew = savedUploadChunks.synchronized {
      savedUploadChunks.get(uploadId) match {
        case Some((_, set)) =>
          set.add(currentChunkNumber)

        case None =>
          savedUploadChunks.put(uploadId,
                                (resumableUploadInformation.totalChunkCount, mutable.HashSet[Int](currentChunkNumber)))
          true
      }
    }
    if (isChunkNew) {
      try {
        val bytes = Files.readAllBytes(chunkFile.toPath)

        this.synchronized {
          val tempFile = new RandomAccessFile(dataBaseDir.resolve(s".$uploadId.temp").toFile, "rw")
          tempFile.seek((currentChunkNumber - 1) * resumableUploadInformation.chunkSize)
          tempFile.write(bytes)
          tempFile.close()
        }
      } catch {
        case e: Exception =>
          savedUploadChunks.synchronized {
            savedUploadChunks(uploadId)._2.remove(currentChunkNumber)
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
    val dataSourceId = DataSourceId(uploadInformation.name, uploadInformation.organization)

    def ensureDirectory(dir: Path) =
      try {
        Fox.successful(PathUtils.ensureDirectory(dir))
      } catch {
        case _: AccessDeniedException => Fox.failure("dataSet.import.fileAccessDenied")
      }

    def ensureAllChunksUploaded = savedUploadChunks.get(uploadId) match {
      case Some((totalChunkNumber, set)) =>
        if (set.size != totalChunkNumber) Fox.failure("dataSet.import.incomplete") else Fox.successful(())
      case None => Fox.failure("dataSet.import.unknownUpload")
    }

    val dataSourceDir =
      if (uploadInformation.needsConversion.getOrElse(false))
        dataBaseDir.resolve(dataSourceId.team).resolve(".forConversion").resolve(dataSourceId.name)
      else
        dataBaseDir.resolve(dataSourceId.team).resolve(dataSourceId.name)

    val zipFile = dataBaseDir.resolve(s".$uploadId.temp").toFile

    logger.info(s"Uploading and unzipping dataset into $dataSourceDir")

    for {
      _ <- savedUploadChunks.synchronized { ensureAllChunksUploaded }
      _ <- ensureDirectory(dataSourceDir)
      unzipResult = this.synchronized {
        ZipIO.unzipToFolder(
          zipFile,
          dataSourceDir,
          includeHiddenFiles = false,
          truncateCommonPrefix = true,
          Some(Category.values.map(_.toString).toList)
        )
      }
      _ = savedUploadChunks.synchronized { savedUploadChunks.remove(uploadId) }
      _ = this.synchronized { zipFile.delete() }
      _ <- unzipResult match {
        case Full(_) =>
          if (uploadInformation.needsConversion.getOrElse(false))
            Fox.successful(())
          else
            dataSourceRepository.updateDataSource(
              dataSourceService.dataSourceFromFolder(dataSourceDir, dataSourceId.team))
        case e =>
          val errorMsg = s"Error unzipping uploaded dataset to $dataSourceDir: $e"
          logger.warn(errorMsg)
          Fox.failure(errorMsg)
      }
    } yield (dataSourceId, uploadInformation.initialTeams)
  }
}
