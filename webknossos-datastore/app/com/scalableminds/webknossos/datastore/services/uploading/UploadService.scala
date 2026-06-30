package com.scalableminds.webknossos.datastore.services.uploading

import com.scalableminds.util.Msg
import com.google.inject.Inject
import com.google.inject.name.Named
import org.apache.pekko.actor.ActorSystem
import scala.concurrent.duration._
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools._
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Header.FILENAME_ATTRIBUTES_JSON
import com.scalableminds.webknossos.datastore.datareaders.n5.{N5Header, N5Metadata}
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedHeader.FILENAME_INFO
import com.scalableminds.webknossos.datastore.datareaders.zarr.NgffMetadata.FILENAME_DOT_ZATTRS
import com.scalableminds.webknossos.datastore.datareaders.zarr.ZarrHeader.FILENAME_DOT_ZARRAY
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader.FILENAME_ZARR_JSON
import com.scalableminds.webknossos.datastore.explore.ExploreLocalLayerService
import com.scalableminds.webknossos.datastore.helpers.{DatasetDeleter, DirectoryConstants, UPath, ZipEntryUPath}
import com.scalableminds.webknossos.datastore.models.LengthUnit.LengthUnit
import com.scalableminds.webknossos.datastore.models.{UnfinishedUpload, VoxelSize}
import com.scalableminds.webknossos.datastore.models.datasource.LayerAttachmentType.LayerAttachmentType
import com.scalableminds.webknossos.datastore.models.datasource.UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.services.uploading.UploadDomain.UploadDomain
import com.scalableminds.webknossos.datastore.services.{DSRemoteWebknossosClient, DataSourceService, ManagedS3Service}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.FileUtils
import play.api.libs.json.{Json, OFormat}
import software.amazon.awssdk.transfer.s3.model.UploadDirectoryRequest

import java.io.{File, RandomAccessFile}
import java.net.URI
import java.nio.file.{Files, Path}
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.FutureConverters._

case class ResumableUploadInfo(
    uploadId: String, // upload id that was also used in chunk upload (this time without file paths)
    totalFileCount: Long,
    filePaths: Option[Seq[String]],
    totalFileSizeInBytes: Option[Long]
)
object ResumableUploadInfo {
  implicit val jsonFormat: OFormat[ResumableUploadInfo] = Json.format[ResumableUploadInfo]
}

case class DatasetUploadInfo(
    resumableUploadInfo: ResumableUploadInfo,
    datasetName: String,
    organizationId: String,
    layersToLink: Option[Seq[LinkedLayerIdentifier]],
    initialTeamIds: Seq[ObjectId], // team ids
    folderId: Option[ObjectId],
    requireUniqueName: Option[Boolean],
    isVirtual: Option[Boolean], // Only set (to false) for legacy manual uploads
    needsConversion: Option[Boolean], // None means false
    voxelSizeFactor: Option[Vec3Double],
    voxelSizeUnit: Option[LengthUnit]
)
object DatasetUploadInfo {
  implicit val jsonFormat: OFormat[DatasetUploadInfo] = Json.format[DatasetUploadInfo]
}

case class MagUploadInfo(
    resumableUploadInfo: ResumableUploadInfo,
    datasetId: ObjectId,
    layerName: String,
    mag: MagLocator,
    overwritePending: Boolean
)
object MagUploadInfo {
  implicit val jsonFormat: OFormat[MagUploadInfo] = Json.format[MagUploadInfo]
}

case class AttachmentUploadInfo(
    resumableUploadInfo: ResumableUploadInfo,
    datasetId: ObjectId,
    layerName: String,
    attachmentType: LayerAttachmentType,
    attachment: LayerAttachment,
    overwritePending: Boolean
)
object AttachmentUploadInfo {
  implicit val jsonFormat: OFormat[AttachmentUploadInfo] = Json.format[AttachmentUploadInfo]
}

case class DatasetUploadAdditionalInfo(newDatasetId: ObjectId, directoryName: String)
object DatasetUploadAdditionalInfo {
  implicit val jsonFormat: OFormat[DatasetUploadAdditionalInfo] =
    Json.format[DatasetUploadAdditionalInfo]
}

case class MagUploadAdditionalInfo(dataSourceId: DataSourceId)
object MagUploadAdditionalInfo {
  implicit val jsonFormat: OFormat[MagUploadAdditionalInfo] =
    Json.format[MagUploadAdditionalInfo]
}

case class AttachmentUploadAdditionalInfo(dataSourceId: DataSourceId)
object AttachmentUploadAdditionalInfo {
  implicit val jsonFormat: OFormat[AttachmentUploadAdditionalInfo] =
    Json.format[AttachmentUploadAdditionalInfo]
}

case class ReportDatasetUploadParameters(
    needsConversion: Boolean,
    datasetSizeBytes: Long,
    dataSourceOpt: Option[UsableDataSource], // must be set if needsConversion is false
    layersToLink: Seq[LinkedLayerIdentifier],
    voxelSize: Option[VoxelSize]
)
object ReportDatasetUploadParameters {
  implicit val jsonFormat: OFormat[ReportDatasetUploadParameters] =
    Json.format[ReportDatasetUploadParameters]
}
case class ReportMagUploadParameters(
    datasetId: ObjectId,
    layerName: String,
    mag: MagLocator,
    magSizeBytes: Long
)
object ReportMagUploadParameters {
  implicit val jsonFormat: OFormat[ReportMagUploadParameters] = Json.format[ReportMagUploadParameters]
}
case class ReportAttachmentUploadParameters(
    datasetId: ObjectId,
    layerName: String,
    attachmentType: LayerAttachmentType,
    attachment: LayerAttachment,
    attachmentSizeBytes: Long
)
object ReportAttachmentUploadParameters {
  implicit val jsonFormat: OFormat[ReportAttachmentUploadParameters] = Json.format[ReportAttachmentUploadParameters]
}

case class LinkedLayerIdentifier(datasetId: ObjectId, layerName: String, newLayerName: Option[String] = None)

object LinkedLayerIdentifier {
  implicit val jsonFormat: OFormat[LinkedLayerIdentifier] = Json.format[LinkedLayerIdentifier]
}

case class CancelUploadInformation(uploadId: String)
object CancelUploadInformation {
  implicit val jsonFormat: OFormat[CancelUploadInformation] = Json.format[CancelUploadInformation]
}

class UploadService @Inject() (
    dataSourceService: DataSourceService,
    datasetUploadMetadataStore: DatasetUploadMetadataStore,
    magUploadMetadataStore: MagUploadMetadataStore,
    attachmentUploadMetadataStore: AttachmentUploadMetadataStore,
    dataVaultService: DataVaultService,
    exploreLocalLayerService: ExploreLocalLayerService,
    dataStoreConfig: DataStoreConfig,
    managedS3Service: ManagedS3Service,
    val remoteWebknossosClient: DSRemoteWebknossosClient,
    @Named("webknossos-datastore") actorSystem: ActorSystem
)(implicit ec: ExecutionContext)
    extends DatasetDeleter
    with DirectoryConstants
    with WKWDataFormatHelper
    with LazyLogging {

  actorSystem.scheduler.scheduleOnce(10 seconds)(cleanUpOrphanUploads())

  private def selectUploadMetadataStore(uploadDomain: UploadDomain) = uploadDomain match {
    case UploadDomain.dataset    => datasetUploadMetadataStore
    case UploadDomain.mag        => magUploadMetadataStore
    case UploadDomain.attachment => attachmentUploadMetadataStore
  }

  override def dataBaseDir: Path = dataSourceService.dataBaseDir

  def isKnownUploadByFileId(uploadFileId: String, uploadDomain: UploadDomain): Fox[Boolean] =
    selectUploadMetadataStore(uploadDomain).isKnownUpload(extractDatasetUploadId(uploadFileId))

  def isKnownUpload(uploadId: String, uploadDomain: UploadDomain): Fox[Boolean] =
    selectUploadMetadataStore(uploadDomain).isKnownUpload(uploadId)

  def getDatasetIdByUploadId(uploadId: String, uploadDomain: UploadDomain): Fox[ObjectId] =
    selectUploadMetadataStore(uploadDomain).findDatasetId(uploadId)

  def extractDatasetUploadId(uploadFileId: String): String = uploadFileId.split("/").headOption.getOrElse("")

  private def uploadDirectoryFor(organizationId: String, uploadId: String, uploadDomain: UploadDomain): Path =
    dataBaseDir.resolve(organizationId).resolve(uploadingDir).resolve(uploadDomain.toString).resolve(uploadId)

  private def uploadBackupDirectoryFor(organizationId: String, uploadId: String): Path =
    dataBaseDir.resolve(organizationId).resolve(trashDir).resolve(s"uploadBackup__$uploadId")

  def reserveDatasetUpload(
      datasetUploadInfo: DatasetUploadInfo,
      datasetId: ObjectId,
      directoryName: String
  ): Fox[Unit] = {
    val dataSourceId = DataSourceId(directoryName, datasetUploadInfo.organizationId)
    val needsConversion = datasetUploadInfo.needsConversion.getOrElse(false)
    for {
      _ <- Fox.fromBool(
        !needsConversion || !datasetUploadInfo.layersToLink.exists(_.nonEmpty)
      ) ?~> "Cannot use linked layers if the dataset needs conversion"
      _ <- reserveResumableUpload(datasetUploadInfo.resumableUploadInfo, datasetId, dataSourceId, UploadDomain.dataset)
      uploadId = datasetUploadInfo.resumableUploadInfo.uploadId
      voxelSizeOpt = datasetUploadInfo.voxelSizeFactor.map(
        VoxelSize.fromFactorAndUnitWithDefault(_, datasetUploadInfo.voxelSizeUnit)
      )
      _ <- datasetUploadMetadataStore.insertUploadIdByDataSourceId(dataSourceId, uploadId)
      _ <- datasetUploadMetadataStore.insertLinkedLayerIdentifiers(uploadId, datasetUploadInfo.layersToLink)
      _ <- datasetUploadMetadataStore.insertNeedsConversion(uploadId, needsConversion)
      _ <- Fox.runOptional(voxelSizeOpt)(datasetUploadMetadataStore.insertVoxelSize(uploadId, _))
    } yield ()
  }

  def reserveMagUpload(magUploadInfo: MagUploadInfo, dataSourceId: DataSourceId): Fox[Unit] = {
    val uploadId = magUploadInfo.resumableUploadInfo.uploadId
    for {
      _ <- reserveResumableUpload(
        magUploadInfo.resumableUploadInfo,
        magUploadInfo.datasetId,
        dataSourceId,
        UploadDomain.mag
      )
      _ <- magUploadMetadataStore.insertMag(uploadId, magUploadInfo.mag.withoutCredentials)
      _ <- magUploadMetadataStore.insertLayerName(uploadId, magUploadInfo.layerName)
    } yield ()
  }

  def reserveAttachmentUpload(attachmentUploadInfo: AttachmentUploadInfo, dataSourceId: DataSourceId): Fox[Unit] =
    for {
      _ <- reserveResumableUpload(
        attachmentUploadInfo.resumableUploadInfo,
        attachmentUploadInfo.datasetId,
        dataSourceId,
        UploadDomain.attachment
      )
      uploadId = attachmentUploadInfo.resumableUploadInfo.uploadId
      _ <- attachmentUploadMetadataStore.insertAttachment(uploadId, attachmentUploadInfo.attachment.withoutCredential)
      _ <- attachmentUploadMetadataStore.insertAttachmentType(uploadId, attachmentUploadInfo.attachmentType)
      _ <- attachmentUploadMetadataStore.insertLayerName(uploadId, attachmentUploadInfo.layerName)
    } yield ()

  private def reserveResumableUpload(
      resumableUploadInfo: ResumableUploadInfo,
      datasetId: ObjectId,
      dataSourceId: DataSourceId,
      uploadDomain: UploadDomain
  ): Fox[Unit] =
    for {
      _ <- dataSourceService.ensureDataDirWritable(dataSourceId)
      uploadId = resumableUploadInfo.uploadId
      _ = logger.info(f"Reserving ${uploadFullName(uploadDomain, uploadId, datasetId, dataSourceId)}...")
      uploadMetadataStore = selectUploadMetadataStore(uploadDomain)
      _ <- uploadMetadataStore.insertDataSourceId(uploadId, dataSourceId)
      _ <- uploadMetadataStore.insertDatasetId(uploadId, datasetId)
      _ <- uploadMetadataStore.insertTotalFileCount(uploadId, resumableUploadInfo.totalFileCount)
      _ <- uploadMetadataStore.insertTotalFileSizeInBytes(uploadId, resumableUploadInfo.totalFileSizeInBytes)
      _ <- uploadMetadataStore.insertFilePaths(uploadId, resumableUploadInfo.filePaths)
    } yield ()

  def enrichUnfinishedUploadInfoWithUploadIds(
      unfinishedUploadsWithoutIds: List[UnfinishedUpload]
  ): Future[List[UnfinishedUpload]] =
    for {
      maybeUnfinishedUploads: List[Box[Option[UnfinishedUpload]]] <- Fox.sequence(
        // Previously rejected uploads may still appear in this list, but don’t have entries in redis. We can use that to filter them out here, since we don’t want to list them to the user. Those that *do* have entries in redis are then enriched using info from there (uploadId and filePaths).
        unfinishedUploadsWithoutIds.map(unfinishedUpload =>
          for {
            uploadIdBox <- datasetUploadMetadataStore.findUploadIdByDataSourceId(unfinishedUpload.dataSourceId).shiftBox
            updatedUploadOpt = uploadIdBox.toOption.map(uploadId => unfinishedUpload.copy(uploadId = uploadId))
            updatedUploadWithFilePathsOpt <- Fox.runOptional(updatedUploadOpt)(updatedUpload =>
              for {
                filePaths <- datasetUploadMetadataStore.findFilePaths(updatedUpload.uploadId)
                uploadUpdatedWithFilePaths = updatedUpload.copy(filePaths = Some(filePaths))
              } yield uploadUpdatedWithFilePaths
            )
          } yield updatedUploadWithFilePathsOpt
        )
      )
      foundUnfinishedUploads = maybeUnfinishedUploads.flatten.flatten
    } yield foundUnfinishedUploads

  private def isOutsideUploadDir(uploadDir: Path, filePath: String): Boolean =
    uploadDir.relativize(uploadDir.resolve(filePath)).startsWith("../")

  private def getFilePathAndDirForUploadFileId(
      uploadFileId: String,
      uploadDomain: UploadDomain
  ): Fox[(String, Path)] = {
    val uploadMetadataStore = selectUploadMetadataStore(uploadDomain)
    val uploadId = extractDatasetUploadId(uploadFileId)
    for {
      dataSourceId <- uploadMetadataStore.findDataSourceId(uploadId)
      uploadDir = uploadDirectoryFor(dataSourceId.organizationId, uploadId, uploadDomain)
      filePathRaw = uploadFileId.split("/").tail.mkString("/")
      filePath = if (filePathRaw.charAt(0) == '/') filePathRaw.drop(1) else filePathRaw
      _ <- Fox.fromBool(!isOutsideUploadDir(uploadDir, filePath)) ?~> s"Invalid file path: $filePath"
    } yield (filePath, uploadDir)
  }

  def isChunkPresent(uploadFileId: String, currentChunkNumber: Long, uploadDomain: UploadDomain): Fox[Boolean] = {
    val uploadMetadataStore = selectUploadMetadataStore(uploadDomain)
    val uploadId = extractDatasetUploadId(uploadFileId)
    for {
      (filePath, _) <- getFilePathAndDirForUploadFileId(uploadFileId, uploadDomain)
      isFileKnown <- uploadMetadataStore.isFileKnown(uploadId, filePath)
      isFilesChunkSetKnown <- Fox.runIf(isFileKnown)(uploadMetadataStore.isFileChunkSetKnown(uploadId, filePath))
      isChunkPresent <- Fox.runIf(isFileKnown)(
        uploadMetadataStore.isChunkPresent(uploadId, filePath, currentChunkNumber)
      )
    } yield isFileKnown && isFilesChunkSetKnown.getOrElse(false) && isChunkPresent.getOrElse(false)
  }

  def handleUploadChunk(
      uploadFileId: String,
      chunkSize: Long,
      currentChunkSize: Long,
      totalChunkCount: Long,
      currentChunkNumber: Long,
      chunkFile: File,
      uploadDomain: UploadDomain
  ): Fox[Unit] = {
    val uploadMetadataStore = selectUploadMetadataStore(uploadDomain)
    val uploadId = extractDatasetUploadId(uploadFileId)
    for {
      datasetId <- uploadMetadataStore.findDatasetId(uploadId)
      dataSourceId <- uploadMetadataStore.findDataSourceId(uploadId)
      (filePath, uploadDir) <- getFilePathAndDirForUploadFileId(uploadFileId, uploadDomain)
      isFileKnown <- uploadMetadataStore.isFileKnown(uploadId, filePath)
      _ <- Fox.runIf(!isFileKnown) {
        for {
          _ <- uploadMetadataStore.insertFilePathIntoSet(uploadId, filePath)
          _ <- uploadMetadataStore.insertFileChunkCount(uploadId, filePath, totalChunkCount)
        } yield ()
      }
      isNewChunk <- uploadMetadataStore.insertFileChunkIntoSet(uploadId, filePath, currentChunkNumber)
      _ <- Fox.runIf(isNewChunk) {
        try {
          val bytes = Files.readAllBytes(chunkFile.toPath)
          if (bytes.length > currentChunkSize) {
            throw new Exception(
              s"Chunk request currentChunkSize $currentChunkSize doesn’t match passed file length ${bytes.length}"
            )
          }
          PathUtils.ensureDirectory(uploadDir.resolve(filePath).getParent)
          val tempFile = new RandomAccessFile(uploadDir.resolve(filePath).toFile, "rw")
          tempFile.seek((currentChunkNumber - 1) * chunkSize)
          tempFile.write(bytes)
          tempFile.close()
          Fox.successful(())
        } catch {
          case e: Exception =>
            uploadMetadataStore.removeFileChunkFromSet(uploadId, filePath, currentChunkNumber)
            val errorMsg =
              s"Error receiving chunk $currentChunkNumber for ${uploadFullName(uploadDomain, uploadId, datasetId, dataSourceId)}: ${e.getMessage}"
            logger.warn(errorMsg)
            Fox.failure(errorMsg)
        }
      }
    } yield ()
  }

  def cancelUpload(uploadDomain: UploadDomain, uploadId: String): Fox[Unit] = {
    val uploadMetadataStore = selectUploadMetadataStore(uploadDomain)
    for {
      dataSourceId <- uploadMetadataStore.findDataSourceId(uploadId)
      datasetId <- uploadMetadataStore.findDatasetId(uploadId)
      knownUpload <- uploadMetadataStore.isKnownUpload(uploadId)
    } yield
      if (knownUpload) {
        logger.info(f"Cancelling ${uploadFullName(uploadDomain, uploadId, datasetId, dataSourceId)}...")
        cleanUpUploaded(uploadId, reason = "Cancelled by user", uploadDomain)
      } else Fox.failure("Unknown upload")
  }

  private def uploadFullName(
      uploadDomain: UploadDomain,
      uploadId: String,
      datasetId: ObjectId,
      dataSourceId: DataSourceId
  ) =
    s"upload $uploadId for $uploadDomain (dataset $datasetId - $dataSourceId)"

  def finishDatasetUpload(uploadId: String, datasetId: ObjectId)(using tc: TokenContext): Fox[Unit] =
    for {
      dataSourceId <- datasetUploadMetadataStore.findDataSourceId(uploadId)
      needsConversion <- datasetUploadMetadataStore.findNeedsConversion(uploadId)
      voxelSizeBox <- datasetUploadMetadataStore.findVoxelSize(uploadId).shiftBox
      _ = logger.info(s"Finishing ${uploadFullName(UploadDomain.dataset, uploadId, datasetId, dataSourceId)}...")
      linkedLayerIdentifiers <- datasetUploadMetadataStore.findLinkedLayerIdentifiers(uploadId)
      uploadDir = uploadDirectoryFor(dataSourceId.organizationId, uploadId, UploadDomain.dataset)
      _ <- backupRawUploadedData(
        uploadDir,
        uploadBackupDirectoryFor(dataSourceId.organizationId, uploadId),
        datasetId
      ).toFox
      _ <- checkWithinRequestedFileSize(
        uploadDir,
        uploadId,
        datasetId,
        UploadDomain.dataset
      ) ?~> Msg.Dataset.Upload.fileSizeCheckFailed
      _ <- checkAllChunksUploaded(uploadId, UploadDomain.dataset) ?~> Msg.Dataset.Upload.allChunksUploadedCheckFailed
      unpackToDir = unpackToDirFor(dataSourceId, UploadDomain.dataset, uploadId)
      unpackResult <- unpackOrMoveUploaded(uploadDir, unpackToDir, datasetId, UploadDomain.dataset).shiftBox
      _ <- cleanUpUploaded(uploadId, reason = "Upload complete, data unpacked.", UploadDomain.dataset)
      _ <- cleanUpOnFailure(
        unpackResult,
        datasetId,
        dataSourceId,
        unpackToDir,
        label = s"unpacking dataset to $unpackToDir"
      )
      postProcessingResult <- exploreUploadedDataSourceIfNeeded(needsConversion, unpackToDir, dataSourceId).shiftBox
      _ <- cleanUpOnFailure(
        postProcessingResult,
        datasetId,
        dataSourceId,
        unpackToDir,
        label = s"processing dataset at $unpackToDir"
      )
      datasetSizeBytes <- measureDirectorySizeBytes(unpackToDir) ?~> Msg.Dataset.Upload.measureTotalSizeFailed
      dataSourceWithAbsolutePathsOpt <- moveUnpackedDatasetToTarget(
        unpackToDir,
        needsConversion,
        datasetId,
        dataSourceId
      ) ?~> Msg.Dataset.Upload.moveUnpackedToTargetFailed
      _ <- remoteWebknossosClient.reportDatasetUpload(
        datasetId,
        ReportDatasetUploadParameters(
          needsConversion,
          datasetSizeBytes,
          dataSourceWithAbsolutePathsOpt,
          linkedLayerIdentifiers,
          voxelSizeBox.toOption
        )
      ) ?~> Msg.Dataset.Upload.reportUploadFailed
    } yield ()

  private def measureDirectorySizeBytes(path: Path): Fox[Long] =
    tryo(FileUtils.sizeOfDirectoryAsBigInteger(path.toFile).longValue).toFox

  def finishMagUpload(uploadId: String, datasetId: ObjectId): Fox[Unit] =
    for {
      dataSourceId <- magUploadMetadataStore.findDataSourceId(uploadId)
      mag <- magUploadMetadataStore.findMag(uploadId)
      layerName <- magUploadMetadataStore.findLayerName(uploadId)
      uploadDir = uploadDirectoryFor(dataSourceId.organizationId, uploadId, UploadDomain.mag)
      unpackToDir = unpackToDirFor(dataSourceId, UploadDomain.mag, uploadId)
        .resolve(mag.mag.toMagLiteral(allowScalar = true))
      _ <- checkWithinRequestedFileSize(
        uploadDir,
        uploadId,
        datasetId,
        UploadDomain.mag
      ) ?~> "dataset.upload.fileSizeCheck.failed"
      _ <- checkAllChunksUploaded(uploadId, UploadDomain.mag) ?~> "dataset.upload.allChunksUploadedCheck.failed"
      unpackResult <- unpackOrMoveUploaded(uploadDir, unpackToDir, datasetId, UploadDomain.mag).shiftBox
      _ <- cleanUpOnFailure(
        unpackResult,
        datasetId,
        dataSourceId,
        unpackToDir,
        label = s"unpacking mag to $unpackToDir"
      )
      _ <- cleanUpUploaded(uploadId, reason = "Upload complete, data unpacked.", UploadDomain.mag)
      magSizeBytes <- measureDirectorySizeBytes(unpackToDir) ?~> "dataset.upload.measureTotalSize.failed"
      finalPath <- moveUnpackedMagOrAttachmentToTarget(
        unpackToDir,
        layerName,
        datasetId,
        dataSourceId,
        s"${mag.mag.toMagLiteral(true)}__${ObjectId.generate}",
        UploadDomain.mag
      )
      magAdapted = mag.copy(path = Some(finalPath))
      _ <- remoteWebknossosClient.reportMagUpload(
        ReportMagUploadParameters(datasetId, layerName, magAdapted, magSizeBytes)
      )
    } yield ()

  def finishAttachmentUpload(uploadId: String, datasetId: ObjectId): Fox[Unit] =
    for {
      dataSourceId <- attachmentUploadMetadataStore.findDataSourceId(uploadId)
      attachment <- attachmentUploadMetadataStore.findAttachment(uploadId)
      attachmentType <- attachmentUploadMetadataStore.findAttachmentType(uploadId)
      layerName <- attachmentUploadMetadataStore.findLayerName(uploadId)
      uploadDir = uploadDirectoryFor(dataSourceId.organizationId, uploadId, UploadDomain.attachment)
      unpackToDir = unpackToDirFor(dataSourceId, UploadDomain.attachment, uploadId)
      _ <- checkWithinRequestedFileSize(
        uploadDir,
        uploadId,
        datasetId,
        UploadDomain.attachment
      ) ?~> "dataset.upload.fileSizeCheck.failed"
      _ <- checkAllChunksUploaded(uploadId, UploadDomain.attachment) ?~> "dataset.upload.allChunksUploadedCheck.failed"
      unpackResult <- unpackOrMoveUploaded(uploadDir, unpackToDir, datasetId, UploadDomain.attachment).shiftBox
      _ <- cleanUpOnFailure(
        unpackResult,
        datasetId,
        dataSourceId,
        unpackToDir,
        label = s"unpacking attachment to $unpackToDir"
      )
      _ <- cleanUpUploaded(uploadId, reason = "Upload complete, data unpacked.", UploadDomain.attachment)
      attachmentSizeBytes <- measureDirectorySizeBytes(unpackToDir) ?~> "dataset.upload.measureTotalSize.failed"
      finalPath <- moveUnpackedMagOrAttachmentToTarget(
        unpackToDir,
        layerName,
        datasetId,
        dataSourceId,
        s"$attachmentType/${TextUtils.normalizeStrong(attachment.name)}__${ObjectId.generate}",
        UploadDomain.attachment
      )
      attachmentAdapted = attachment.copy(path = finalPath)
      _ <- remoteWebknossosClient.reportAttachmentUpload(
        ReportAttachmentUploadParameters(datasetId, layerName, attachmentType, attachmentAdapted, attachmentSizeBytes)
      )
    } yield ()

  private def checkWithinRequestedFileSize(
      uploadDir: Path,
      uploadId: String,
      datasetId: ObjectId,
      uploadDomain: UploadDomain
  ): Fox[Unit] = {
    val uploadMetadataStore = selectUploadMetadataStore(uploadDomain)
    for {
      totalFileSizeInBytesBox <- uploadMetadataStore
        .findTotalFileSizeInBytes(uploadId)
        .shiftBox ?~> "Could not look up reserved total file size"
      _ <- totalFileSizeInBytesBox.map { reservedFileSize =>
        for {
          actualFileSize <- tryo(
            FileUtils.sizeOfDirectoryAsBigInteger(uploadDir.toFile).longValue
          ).toFox ?~> "Could not measure actual file size"
          _ <-
            if (actualFileSize > reservedFileSize) {
              cleanUpExceedingSize(uploadId, uploadDomain)
              Fox.failure(
                f"Uploaded $uploadDomain $datasetId exceeds the reserved size of $reservedFileSize bytes, got $actualFileSize bytes."
              )
            } else Fox.successful(())
        } yield ()
      }.getOrElse(Fox.successful(()))
    } yield ()
  }

  private def cleanUpExceedingSize(uploadId: String, uploadDomain: UploadDomain): Fox[Unit] =
    for {
      datasetId <- getDatasetIdByUploadId(uploadId, uploadDomain)
      _ <- cleanUpUploaded(uploadId, reason = "Exceeded reserved fileSize", uploadDomain)
      // Datasets need to be cleaned up in postgres as well. The other domains don’t (overwritePending mechanism is used there)
      _ <- Fox.runIf(uploadDomain == UploadDomain.dataset)(remoteWebknossosClient.deleteDataset(datasetId))
    } yield ()

  private def deleteFilesNotReferencedInDataSource(unpackedDir: Path, dataSource: UsableDataSource): Fox[Unit] =
    for {
      filesToDelete <- findNonReferencedFiles(unpackedDir, dataSource)
      _ = if (filesToDelete.nonEmpty)
        logger.info(s"Uploaded dataset contains files not referenced in the datasource. Deleting $filesToDelete...")
      _ = filesToDelete.foreach(file =>
        try
          Files.deleteIfExists(file)
        catch {
          case e: Exception =>
            logger.warn(s"Deletion failed for non-referenced file $file of uploaded dataset: ${e.getMessage}")
        }
      )
    } yield ()

  private def moveUnpackedMagOrAttachmentToTarget(
      unpackedDir: Path,
      layerName: String,
      datasetId: ObjectId,
      dataSourceId: DataSourceId,
      dirName: String,
      domain: UploadDomain
  ): Fox[UPath] =
    if (dataStoreConfig.Datastore.S3Upload.enabled) {
      for {
        s3UploadBucket <- managedS3Service.s3UploadBucketOpt.toFox
        _ = logger.info(s"finishUpload for $domain ($datasetId): Copying data to s3 bucket $s3UploadBucket...")
        beforeS3Upload = Instant.now
        s3ObjectKey =
          s"${dataStoreConfig.Datastore.S3Upload.objectKeyPrefix}/${dataSourceId.organizationId}/${dataSourceId.directoryName}/$layerName/$dirName"
        _ <- uploadDirectoryToS3(unpackedDir, s3UploadBucket, s3ObjectKey)
        _ = Instant.logSince(beforeS3Upload, s"Forwarding of uploaded mag for $datasetId ($dataSourceId) to S3", logger)
        endPointHost = new URI(dataStoreConfig.Datastore.S3Upload.credentialName).getHost
        finalUploadedS3Path <- UPath.fromString(s"s3://$endPointHost/$s3UploadBucket/$s3ObjectKey").toFox
      } yield finalUploadedS3Path
    } else {
      val finalUploadedLocalPath =
        dataBaseDir
          .resolve(dataSourceId.organizationId)
          .resolve(dataSourceId.directoryName)
          .resolve(layerName)
          .resolve(dirName)
      logger.info(s"finishUpload for $domain ($datasetId): Moving data to final local path $finalUploadedLocalPath...")
      for {
        _ <- tryo(FileUtils.moveDirectory(unpackedDir.toFile, finalUploadedLocalPath.toFile)).toFox
      } yield UPath.fromLocalPath(finalUploadedLocalPath)
    }

  private def moveUnpackedDatasetToTarget(
      unpackedDir: Path,
      needsConversion: Boolean,
      datasetId: ObjectId,
      dataSourceId: DataSourceId
  ): Fox[Option[UsableDataSource]] =
    if (needsConversion) {
      logger.info(s"finishUpload for $datasetId: Moving data to input dir for worker conversion...")
      val forConversionPath =
        dataBaseDir.resolve(dataSourceId.organizationId).resolve(forConversionDir).resolve(dataSourceId.directoryName)
      for {
        _ <- tryo(FileUtils.moveDirectory(unpackedDir.toFile, forConversionPath.toFile)).toFox
      } yield None
    } else {
      for {
        dataSourceFromDir <- Fox.successful(
          dataSourceService.dataSourceFromDir(unpackedDir, dataSourceId.organizationId, resolvePaths = false)
        )
        usableDataSourceFromDir <-
          dataSourceFromDir.toUsable.toFox ?~> s"Invalid dataset uploaded: ${dataSourceFromDir.statusOpt.getOrElse("")}"
        _ <- deleteFilesNotReferencedInDataSource(unpackedDir, usableDataSourceFromDir)
        newBasePath <-
          if (dataStoreConfig.Datastore.S3Upload.enabled) {
            for {
              s3UploadBucket <- managedS3Service.s3UploadBucketOpt.toFox
              _ = logger.info(s"finishUpload for $datasetId: Copying data to s3 bucket $s3UploadBucket...")
              beforeS3Upload = Instant.now
              s3ObjectKey =
                s"${dataStoreConfig.Datastore.S3Upload.objectKeyPrefix}/${dataSourceId.organizationId}/${dataSourceId.directoryName}/"
              _ <- uploadDirectoryToS3(unpackedDir, s3UploadBucket, s3ObjectKey)
              _ = Instant.logSince(
                beforeS3Upload,
                s"Forwarding of uploaded dataset $datasetId ($dataSourceId) to S3",
                logger
              )
              endPointHost = new URI(dataStoreConfig.Datastore.S3Upload.credentialName).getHost
              newBasePath <- UPath.fromString(s"s3://$endPointHost/$s3UploadBucket/$s3ObjectKey").toFox
            } yield newBasePath
          } else {
            val finalUploadedLocalPath =
              dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
            logger.info(s"finishUpload for $datasetId: Moving data to final local path $finalUploadedLocalPath...")
            for {
              _ <- tryo(FileUtils.moveDirectory(unpackedDir.toFile, finalUploadedLocalPath.toFile)).toFox
            } yield UPath.fromLocalPath(finalUploadedLocalPath)
          }
        dataSourceWithAdaptedPaths = dataSourceService.resolvePathsInNewBasePath(usableDataSourceFromDir, newBasePath)
        _ = PathUtils.deleteDirectoryRecursively(unpackedDir)
      } yield Some(dataSourceWithAdaptedPaths)
    }

  private def exploreUploadedDataSourceIfNeeded(
      needsConversion: Boolean,
      unpackToDir: Path,
      dataSourceId: DataSourceId
  ): Fox[Unit] =
    if (needsConversion)
      Fox.successful(())
    else {
      for {
        _ <- Fox.successful(())
        uploadedDataSourceType = guessTypeOfUploadedDataSource(unpackToDir)
        _ <- uploadedDataSourceType match {
          case UploadedDataSourceType.ZARR | UploadedDataSourceType.ZARR3 |
              UploadedDataSourceType.NEUROGLANCER_PRECOMPUTED | UploadedDataSourceType.N5_MULTISCALES |
              UploadedDataSourceType.N5_ARRAY =>
            exploreLocalDatasource(unpackToDir, dataSourceId, uploadedDataSourceType)
          case UploadedDataSourceType.EXPLORED =>
            checkPathsInUploadedDatasourcePropertiesJson(unpackToDir, dataSourceId.organizationId)
          case UploadedDataSourceType.ZARR_MULTILAYER | UploadedDataSourceType.ZARR3_MULTILAYER |
              UploadedDataSourceType.NEUROGLANCER_MULTILAYER | UploadedDataSourceType.N5_MULTILAYER =>
            tryExploringMultipleLayers(unpackToDir, dataSourceId, uploadedDataSourceType)
          case UploadedDataSourceType.WKW => addLayerAndMagDirIfMissing(unpackToDir).toFox
        }
      } yield ()
    }

  private def checkPathsInUploadedDatasourcePropertiesJson(unpackToDir: Path, organizationId: String): Fox[Unit] = {
    val dataSource = dataSourceService.dataSourceFromDir(unpackToDir, organizationId, resolvePaths = false)
    for {
      _ <- Fox.runOptional(dataSource.toUsable)(usableDataSource =>
        Fox.fromBool(
          usableDataSource.allExplicitPaths.forall(dataVaultService.pathIsAllowedToAddDirectly)
        ) ?~> Msg.Dataset.Upload.disallowedPaths
      )
    } yield ()
  }

  private def exploreLocalDatasource(
      path: Path,
      dataSourceId: DataSourceId,
      typ: UploadedDataSourceType.Value
  ): Fox[Unit] =
    for {
      _ <- Fox.runIf(typ == UploadedDataSourceType.ZARR)(addLayerAndMagDirIfMissing(path, FILENAME_DOT_ZARRAY).toFox)
      _ <- Fox.runIf(typ == UploadedDataSourceType.ZARR3)(addLayerAndMagDirIfMissing(path, FILENAME_ZARR_JSON).toFox)
      explored <- exploreLocalLayerService.exploreLocal(path, dataSourceId)
      _ <- exploreLocalLayerService.writeLocalDatasourceProperties(explored, path)
    } yield ()

  private def tryExploringMultipleLayers(
      path: Path,
      dataSourceId: DataSourceId,
      typ: UploadedDataSourceType.Value
  ): Fox[Option[Path]] =
    for {
      layerDirs <- typ match {
        case UploadedDataSourceType.ZARR_MULTILAYER  => getZarrLayerDirectories(path).toFox
        case UploadedDataSourceType.ZARR3_MULTILAYER => getZarr3LayerDirectories(path).toFox
        case UploadedDataSourceType.NEUROGLANCER_MULTILAYER | UploadedDataSourceType.N5_MULTILAYER =>
          PathUtils.listDirectories(path, silent = false).toFox
      }
      dataSources <- Fox.combined(
        layerDirs
          .map(layerDir =>
            for {
              _ <- addLayerAndMagDirIfMissing(layerDir).toFox
              explored: UsableDataSource <- exploreLocalLayerService
                .exploreLocal(path, dataSourceId, layerDir.getFileName.toString)
            } yield explored
          )
          .toList
      )
      combinedLayers = exploreLocalLayerService.makeLayerNamesUnique(dataSources.flatMap(_.dataLayers))
      firstExploredDatasource <- dataSources.headOption.toFox
      dataSource = UsableDataSource(dataSourceId, combinedLayers, firstExploredDatasource.scale)
      path <- Fox.runIf(combinedLayers.nonEmpty)(
        exploreLocalLayerService.writeLocalDatasourceProperties(dataSource, path)
      )
    } yield path

  private def uploadDirectoryToS3(
      dataDir: Path,
      bucketName: String,
      prefix: String
  ): Fox[Unit] =
    for {
      transferManager <-
        managedS3Service.s3UploadTransferManagerFox ?~> "S3 upload is not properly configured, cannot get S3 client"
      directoryUpload = transferManager.uploadDirectory(
        UploadDirectoryRequest.builder().bucket(bucketName).s3Prefix(prefix).source(dataDir).build()
      )
      completedUpload <- Fox.fromFuture(directoryUpload.completionFuture().asScala)
      failedTransfers = completedUpload.failedTransfers()
      _ <- Fox.fromBool(failedTransfers.isEmpty) ?~>
        s"Some files failed to upload to S3: $failedTransfers"
    } yield ()

  private def findNonReferencedFiles(unpackedDir: Path, dataSource: UsableDataSource): Fox[List[Path]] = {
    val explicitPaths: Set[Path] = dataSource.dataLayers
      .flatMap(layer =>
        layer.allExplicitPaths.map {
          case ZipEntryUPath(outerPath, _) => outerPath // The whole zip of each ZipEntryUPath is considered referenced.
          case path                        => path
        }.flatMap(_.toLocalPath)
      )
      .map(unpackedDir.resolve)
      .toSet
    val additionalMagPaths: Set[Path] = dataSource.dataLayers
      .flatMap(layer =>
        layer.mags.map(mag =>
          mag.path match {
            case Some(_) => None
            case None    => Some(unpackedDir.resolve(List(layer.name, mag.mag.toMagLiteral(true)).mkString("/")))
          }
        )
      )
      .flatten
      .toSet

    val allReferencedPaths = explicitPaths ++ additionalMagPaths
    for {
      allFiles <- PathUtils.listFilesRecursive(unpackedDir, silent = true, maxDepth = 10).toFox
      filesToDelete = allFiles.filterNot(file => allReferencedPaths.exists(neededPath => file.startsWith(neededPath)))
    } yield filesToDelete
  }

  private def cleanUpOnFailure[T](
      result: Box[T],
      datasetId: ObjectId,
      dataSourceId: DataSourceId,
      unpackToDir: Path,
      label: String
  ): Fox[Unit] =
    result match {
      case Full(_) =>
        Fox.successful(())
      case Empty =>
        deleteOnDisk(
          datasetId,
          dataSourceId.organizationId,
          dataSourceId.directoryName,
          Some(unpackToDir),
          Some("the upload failed")
        )
        Fox.failure(s"Unknown error $label")
      case Failure(msg, e, _) =>
        logger.warn(s"Error while $label: $msg, $e")
        deleteOnDisk(
          datasetId,
          dataSourceId.organizationId,
          dataSourceId.directoryName,
          Some(unpackToDir),
          Some("the upload failed")
        )
        remoteWebknossosClient.deleteDataset(datasetId)
        for {
          _ <- result.toFox ?~> f"Error while $label"
        } yield ()
    }

  private def checkAllChunksUploaded(uploadId: String, uploadDomain: UploadDomain): Fox[Unit] = {
    val uploadMetadataStore = selectUploadMetadataStore(uploadDomain)
    for {
      fileCount <- uploadMetadataStore.findFileCount(uploadId) ?~> "Could not look up reserved file count."
      fileNames <- uploadMetadataStore.findFileNames(uploadId) ?~> "Could not look up reserved file names."
      _ <- Fox.fromBool(fileCount == fileNames.size) ?~> "Reserved file count does not match file names length."
      _ <- Fox.serialCombined(fileNames) { fileName =>
        for {
          chunkCount <- uploadMetadataStore.findFileChunkCount(
            uploadId,
            fileName
          ) ?~> "Could not look up file chunk count."
          chunkSet <- uploadMetadataStore.findFileChunkSet(uploadId, fileName) ?~> "Could not look up file chunk set."
          _ <- Fox.fromBool(
            chunkCount == chunkSet.size
          ) ?~> s"Chunks missing for uploaded file $fileName: expected $chunkCount, got ${chunkSet.size}."
        } yield ()
      }
    } yield ()
  }

  private def unpackToDirFor(dataSourceId: DataSourceId, domain: UploadDomain, uploadId: String): Path =
    dataBaseDir
      .resolve(dataSourceId.organizationId)
      .resolve(uploadingDir)
      .resolve(unpackedDir)
      .resolve(domain.toString)
      .resolve(uploadId)
      .resolve(dataSourceId.directoryName)

  private def guessTypeOfUploadedDataSource(dataSourceDir: Path): UploadedDataSourceType.Value =
    if (looksLikeExploredDataSource(dataSourceDir).getOrElse(false)) {
      UploadedDataSourceType.EXPLORED
    } else if (looksLikeZarrArray(dataSourceDir, maxDepth = 2).getOrElse(false)) {
      UploadedDataSourceType.ZARR
    } else if (looksLikeZarrArray(dataSourceDir, maxDepth = 3).getOrElse(false)) {
      UploadedDataSourceType.ZARR_MULTILAYER
    } else if (looksLikeZarr3Array(dataSourceDir, maxDepth = 2).getOrElse(false)) {
      UploadedDataSourceType.ZARR3
    } else if (looksLikeZarr3Array(dataSourceDir, maxDepth = 3).getOrElse(false)) {
      UploadedDataSourceType.ZARR3_MULTILAYER
    } else if (looksLikeNeuroglancerPrecomputed(dataSourceDir, 1).getOrElse(false)) {
      UploadedDataSourceType.NEUROGLANCER_PRECOMPUTED
    } else if (looksLikeNeuroglancerPrecomputed(dataSourceDir, 2).getOrElse(false)) {
      UploadedDataSourceType.NEUROGLANCER_MULTILAYER
    } else if (looksLikeN5Multilayer(dataSourceDir).getOrElse(false)) {
      UploadedDataSourceType.N5_MULTILAYER
    } else if (looksLikeN5MultiscalesLayer(dataSourceDir).getOrElse(false)) {
      UploadedDataSourceType.N5_MULTISCALES
    } else if (looksLikeN5Array(dataSourceDir).getOrElse(false)) {
      UploadedDataSourceType.N5_ARRAY
    } else {
      UploadedDataSourceType.WKW
    }

  private def containsMatchingFile(fileNames: List[String], dataSourceDir: Path, maxDepth: Int): Box[Boolean] =
    for {
      listing: Seq[Path] <- PathUtils.listFilesRecursive(
        dataSourceDir,
        maxDepth = maxDepth,
        silent = false,
        filters = p => fileNames.contains(p.getFileName.toString)
      )
    } yield listing.nonEmpty

  private def looksLikeZarrArray(dataSourceDir: Path, maxDepth: Int): Box[Boolean] =
    containsMatchingFile(List(FILENAME_DOT_ZARRAY, FILENAME_DOT_ZATTRS), dataSourceDir, maxDepth)

  private def looksLikeZarr3Array(dataSourceDir: Path, maxDepth: Int): Box[Boolean] =
    containsMatchingFile(List(FILENAME_ZARR_JSON), dataSourceDir, maxDepth)

  private def looksLikeNeuroglancerPrecomputed(dataSourceDir: Path, maxDepth: Int): Box[Boolean] =
    containsMatchingFile(List(FILENAME_INFO), dataSourceDir, maxDepth)

  private def looksLikeN5MultiscalesLayer(dataSourceDir: Path): Box[Boolean] =
    for {
      attributesFiles <- PathUtils.listFilesRecursive(
        dataSourceDir,
        silent = false,
        maxDepth = 1,
        filters = p => p.getFileName.toString == FILENAME_ATTRIBUTES_JSON
      )
      _ <- Box.fromBool(attributesFiles.nonEmpty)
      _ <- JsonHelper.parseAs[N5Metadata](Files.readAllBytes(attributesFiles.head))
    } yield true

  private def looksLikeN5Multilayer(dataSourceDir: Path): Box[Boolean] =
    for {
      matchingFileIsPresent <- containsMatchingFile(
        List(FILENAME_ATTRIBUTES_JSON),
        dataSourceDir,
        1
      ) // root attributes.json
      _ <- Box.fromBool(matchingFileIsPresent)
      directories <- PathUtils.listDirectories(dataSourceDir, silent = false)
      detectedLayerBoxes = directories.map(looksLikeN5MultiscalesLayer)
      _ <- Box.fromBool(detectedLayerBoxes.forall(_.getOrElse(false)))
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
      matchingFileIsPresent <- containsMatchingFile(
        List(FILENAME_ATTRIBUTES_JSON),
        dataSourceDir,
        1
      ) // root attributes.json
      _ <- Box.fromBool(matchingFileIsPresent)
      datasetDir <- PathUtils.listDirectories(dataSourceDir, silent = false).map(_.headOption)
      scaleDirs <- datasetDir.map(PathUtils.listDirectories(_, silent = false)).getOrElse(Full(Seq.empty))
      _ <- Box.fromBool(scaleDirs.length == 1) // Must be 1, otherwise it is a multiscale dataset
      attributesFiles <- PathUtils.listFilesRecursive(
        scaleDirs.head,
        silent = false,
        maxDepth = 1,
        filters = p => p.getFileName.toString == FILENAME_ATTRIBUTES_JSON
      )
      _ <- JsonHelper.parseAs[N5Header](Files.readAllBytes(attributesFiles.head))
    } yield true

  private def looksLikeExploredDataSource(dataSourceDir: Path): Box[Boolean] =
    containsMatchingFile(List(FILENAME_DATASOURCE_PROPERTIES_JSON), dataSourceDir, 1)

  private def getZarrLayerDirectories(dataSourceDir: Path): Box[Seq[Path]] =
    for {
      potentialLayers <- PathUtils.listDirectories(dataSourceDir, silent = false)
      layerDirs = potentialLayers.filter(p => looksLikeZarrArray(p, maxDepth = 2).getOrElse(false))
    } yield layerDirs

  private def getZarr3LayerDirectories(dataSourceDir: Path): Box[Seq[Path]] =
    for {
      potentialLayers <- PathUtils.listDirectories(dataSourceDir, silent = false)
      layerDirs = potentialLayers.filter(p => looksLikeZarr3Array(p, maxDepth = 2).getOrElse(false))
    } yield layerDirs

  private def addLayerAndMagDirIfMissing(dataSourceDir: Path, headerFile: String = FILENAME_HEADER_WKW): Box[Unit] =
    if (Files.exists(dataSourceDir)) {
      for {
        listing: Seq[Path] <- PathUtils.listFilesRecursive(
          dataSourceDir,
          maxDepth = 3,
          silent = false,
          filters = p => p.getFileName.toString == headerFile
        )
        listingRelative = listing.map(dataSourceDir.normalize().relativize(_))
        _ <-
          if (looksLikeMagDir(listingRelative)) {
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

  private def looksLikeMagDir(headerFilePaths: Seq[Path]): Boolean =
    pathExistsWithDepth(0, headerFilePaths) && !pathExistsWithDepth(1, headerFilePaths) && !pathExistsWithDepth(
      2,
      headerFilePaths
    )

  private def looksLikeLayerDir(headerFilePaths: Seq[Path]): Boolean =
    pathExistsWithDepth(1, headerFilePaths) && !pathExistsWithDepth(2, headerFilePaths)

  private def pathExistsWithDepth(pathDepth: Int, paths: Seq[Path]) =
    paths.exists(getPathDepth(_) == pathDepth)

  private def getPathDepth(path: Path) =
    path.toString.count(_ == '/')

  private def unpackOrMoveUploaded(
      uploadDir: Path,
      unpackToDir: Path,
      datasetId: ObjectId,
      uploadDomain: UploadDomain
  ): Fox[Unit] =
    for {
      _ <- PathUtils.ensureDirectoryBox(unpackToDir.getParent).toFox ?~> "dataset.import.fileAccessDenied"
      shallowFileList <- PathUtils.listFiles(uploadDir, silent = false).toFox
      excludeFromPrefix = LayerCategory.values.map(_.toString).toList
      firstFile = shallowFileList.headOption
      _ <-
        if (shallowFileList.length == 1 && shallowFileList.headOption.exists(_.toString.toLowerCase.endsWith(".zip"))) {
          for {
            zipFile <- firstFile.toFox
            _ = logger.info(s"finishUpload for $datasetId: Unzipping $uploadDomain to $unpackToDir...")
            _ <- ZipIO
              .unzipToDirectory(
                zipFile.toFile,
                unpackToDir,
                includeHiddenFiles = false,
                hiddenFilesWhitelist = List(".zarray", ".zattrs"),
                truncateCommonPrefix = true,
                Some(excludeFromPrefix)
              )
              .toFox
            _ <- Fox.fromBool(unpackToDir.toFile.exists()) ?~> Msg.Dataset.Upload.noFiles
          } yield ()
        } else {
          for {
            deepFileList: List[Path] <- PathUtils.listFilesRecursive(uploadDir, silent = false, maxDepth = 10).toFox
            _ <- Fox.fromBool(deepFileList.nonEmpty) ?~> Msg.Dataset.Upload.noFiles
            commonPrefixPreliminary = PathUtils.commonPrefix(deepFileList)
            _ = logger.info(
              s"Detected $uploadDomain root during finishUpload of $datasetId from ${deepFileList.length} files in $uploadDir with commonPrefixPreliminary=$commonPrefixPreliminary"
            )
            strippedPrefix = PathUtils.cutOffPathAtLastOccurrenceOf(commonPrefixPreliminary, excludeFromPrefix)
            commonPrefix = PathUtils.removeSingleFileNameFromPrefix(
              strippedPrefix,
              deepFileList.map(_.getFileName.toString)
            )
            _ <- tryo(
              FileUtils.moveDirectory(new File(commonPrefix.toString), new File(unpackToDir.toString))
            ).toFox ?~> Msg.Dataset.Upload.moveToTargetFailed
          } yield ()
        }
    } yield ()

  private def backupRawUploadedData(uploadDir: Path, backupDir: Path, datasetId: ObjectId): Box[Unit] = {
    logger.info(s"finishUpload for $datasetId: Backing up raw uploaded data...")
    // Backed up within .trash (old files regularly deleted by cronjob)
    tryo(FileUtils.copyDirectory(uploadDir.toFile, backupDir.toFile))
  }

  private def cleanUpUploaded(uploadId: String, reason: String, uploadDomain: UploadDomain): Fox[Unit] = {
    val uploadMetadataStore = selectUploadMetadataStore(uploadDomain)
    for {
      dataSourceId <- uploadMetadataStore.findDataSourceId(uploadId)
      uploadDir = uploadDirectoryFor(dataSourceId.organizationId, uploadId, uploadDomain)
      _ <- Fox.successful(logger.info(s"Cleaning up uploaded $uploadDir. Reason: $reason"))
      _ <- PathUtils.deleteDirectoryRecursively(uploadDir).toFox
      uploadMetadataStore = selectUploadMetadataStore(uploadDomain)
      _ <- uploadMetadataStore.cleanUp(uploadId)
    } yield ()
  }

  private def cleanUpOrphanUploads(): Fox[Unit] =
    for {
      organizationDirs <- PathUtils.listDirectories(dataBaseDir, silent = false).toFox
      _ <- Fox.serialCombined(organizationDirs)(cleanUpOrphanUploadsForOrga)
    } yield ()

  private def cleanUpOrphanUploadsForOrga(organizationDir: Path): Fox[Unit] =
    for {
      _ <- cleanUpOrphanUploadsForOrgaAndDomain(organizationDir, UploadDomain.dataset)
      _ <- cleanUpOrphanUploadsForOrgaAndDomain(organizationDir, UploadDomain.mag)
      _ <- cleanUpOrphanUploadsForOrgaAndDomain(organizationDir, UploadDomain.attachment)
    } yield ()

  private def cleanUpOrphanUploadsForOrgaAndDomain(organizationDir: Path, uploadDomain: UploadDomain): Fox[Unit] = {
    val orgaUploadingDir: Path = organizationDir.resolve(uploadingDir).resolve(uploadDomain.toString)
    if (!Files.exists(orgaUploadingDir))
      Fox.successful(())
    else {
      for {
        uploadDirs <- PathUtils.listDirectories(orgaUploadingDir, silent = false).toFox
        _ <- Fox.serialCombined(uploadDirs) { uploadDir =>
          isKnownUploadOfAnyDomain(uploadDir.getFileName.toString).map {
            case false =>
              val deleteResult = PathUtils.deleteDirectoryRecursively(uploadDir)
              if (deleteResult.isDefined) {
                logger.info(f"Deleted orphan $uploadDomain upload at $uploadDir")
              } else {
                logger.warn(f"Failed to delete orphan $uploadDomain upload at $uploadDir")
              }
            case true => ()
          }
        }
      } yield ()
    }
  }

  private def isKnownUploadOfAnyDomain(uploadId: String): Fox[Boolean] =
    for {
      fromDataset <- datasetUploadMetadataStore.isKnownUpload(uploadId)
      fromMag <- magUploadMetadataStore.isKnownUpload(uploadId)
      fromAttachment <- attachmentUploadMetadataStore.isKnownUpload(uploadId)
    } yield fromDataset || fromMag || fromAttachment

}

object UploadedDataSourceType extends Enumeration {
  val ZARR, ZARR3, ZARR3_MULTILAYER, EXPLORED, ZARR_MULTILAYER, WKW, NEUROGLANCER_PRECOMPUTED, NEUROGLANCER_MULTILAYER,
      N5_MULTISCALES, N5_MULTILAYER, N5_ARRAY = Value
}
