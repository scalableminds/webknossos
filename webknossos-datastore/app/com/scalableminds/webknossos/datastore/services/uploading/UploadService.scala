package com.scalableminds.webknossos.datastore.services.uploading

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools._
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Header.FILENAME_ATTRIBUTES_JSON
import com.scalableminds.webknossos.datastore.datareaders.n5.{N5Header, N5Metadata}
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedHeader.FILENAME_INFO
import com.scalableminds.webknossos.datastore.datareaders.zarr.NgffMetadata.FILENAME_DOT_ZATTRS
import com.scalableminds.webknossos.datastore.datareaders.zarr.ZarrHeader.FILENAME_DOT_ZARRAY
import com.scalableminds.webknossos.datastore.datavault.S3DataVault
import com.scalableminds.webknossos.datastore.explore.ExploreLocalLayerService
import com.scalableminds.webknossos.datastore.helpers.{DatasetDeleter, DirectoryConstants, UPath}
import com.scalableminds.webknossos.datastore.models.UnfinishedUpload
import com.scalableminds.webknossos.datastore.models.datasource.UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.services.{DSRemoteWebknossosClient, DataSourceService}
import com.scalableminds.webknossos.datastore.storage.{
  CredentialConfigReader,
  DataStoreRedisStore,
  RemoteSourceDescriptorService,
  S3AccessKeyCredential
}
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.FileUtils
import play.api.libs.json.{Json, OFormat, Reads}
import software.amazon.awssdk.auth.credentials.{AwsBasicCredentials, StaticCredentialsProvider}
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3AsyncClient
import software.amazon.awssdk.transfer.s3.S3TransferManager
import software.amazon.awssdk.transfer.s3.model.UploadDirectoryRequest

import java.io.{File, RandomAccessFile}
import java.net.URI
import java.nio.file.{Files, Path}
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.FutureConverters._

case class ReserveUploadInformation(
    uploadId: String, // upload id that was also used in chunk upload (this time without file paths)
    name: String, // dataset name
    organization: String,
    totalFileCount: Long,
    filePaths: Option[List[String]],
    totalFileSizeInBytes: Option[Long],
    layersToLink: Option[List[LinkedLayerIdentifier]],
    initialTeams: List[ObjectId], // team ids
    folderId: Option[ObjectId],
    requireUniqueName: Option[Boolean],
    isVirtual: Option[Boolean], // Only set (to false) for legacy manual uploads
    needsConversion: Option[Boolean] // None means false
)
object ReserveUploadInformation {
  implicit val jsonFormat: OFormat[ReserveUploadInformation] = Json.format[ReserveUploadInformation]
}

case class ReserveAdditionalInformation(newDatasetId: ObjectId, directoryName: String)
object ReserveAdditionalInformation {
  implicit val jsonFormat: OFormat[ReserveAdditionalInformation] =
    Json.format[ReserveAdditionalInformation]
}

case class ReportDatasetUploadParameters(
    needsConversion: Boolean,
    datasetSizeBytes: Long,
    dataSourceOpt: Option[UsableDataSource], // must be set if needsConversion is false
    layersToLink: Seq[LinkedLayerIdentifier]
)
object ReportDatasetUploadParameters {
  implicit val jsonFormat: OFormat[ReportDatasetUploadParameters] =
    Json.format[ReportDatasetUploadParameters]
}

case class LinkedLayerIdentifier(datasetId: ObjectId, layerName: String, newLayerName: Option[String] = None)

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

class UploadService @Inject()(dataSourceService: DataSourceService,
                              runningUploadMetadataStore: DataStoreRedisStore,
                              remoteSourceDescriptorService: RemoteSourceDescriptorService,
                              exploreLocalLayerService: ExploreLocalLayerService,
                              dataStoreConfig: DataStoreConfig,
                              val remoteWebknossosClient: DSRemoteWebknossosClient)(implicit ec: ExecutionContext)
    extends DatasetDeleter
    with DirectoryConstants
    with FoxImplicits
    with WKWDataFormatHelper
    with LazyLogging {

  /* Redis stores different information for each upload, with different prefixes in the keys:
   *  uploadId -> fileCount
   *  uploadId -> set(fileName)
   *  uploadId -> dataSourceId
   *  uploadId -> datasetId
   *  uploadId -> linkedLayerIdentifier
   *  uploadId#fileName -> totalChunkCount
   *  uploadId#fileName -> set(chunkIndices)
   * Note that Redis synchronizes all db accesses, so we do not need to do it
   */
  private def redisKeyForFileCount(uploadId: String): String =
    s"upload___${uploadId}___fileCount"
  private def redisKeyForTotalFileSizeInBytes(uploadId: String): String =
    s"upload___${uploadId}___totalFileSizeInBytes"
  private def redisKeyForCurrentUploadedTotalFileSizeInBytes(uploadId: String): String =
    s"upload___${uploadId}___currentUploadedTotalFileSizeInBytes"
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
  private def redisKeyForUploadId(datasourceId: DataSourceId): String =
    s"upload___${Json.stringify(Json.toJson(datasourceId))}___datasourceId"
  private def redisKeyForDatasetId(uploadId: String): String =
    s"upload___${uploadId}___datasetId"
  private def redisKeyForFilePaths(uploadId: String): String =
    s"upload___${uploadId}___filePaths"

  cleanUpOrphanUploads()

  override def dataBaseDir: Path = dataSourceService.dataBaseDir

  def isKnownUploadByFileId(uploadFileId: String): Fox[Boolean] = isKnownUpload(extractDatasetUploadId(uploadFileId))

  def isKnownUpload(uploadId: String): Fox[Boolean] =
    runningUploadMetadataStore.contains(redisKeyForFileCount(uploadId))

  def extractDatasetUploadId(uploadFileId: String): String = uploadFileId.split("/").headOption.getOrElse("")

  private def uploadDirectoryFor(organizationId: String, uploadId: String): Path =
    dataBaseDir.resolve(organizationId).resolve(uploadingDir).resolve(uploadId)

  private def uploadBackupDirectoryFor(organizationId: String, uploadId: String): Path =
    dataBaseDir.resolve(organizationId).resolve(trashDir).resolve(s"uploadBackup__$uploadId")

  private def getDataSourceIdByUploadId(uploadId: String): Fox[DataSourceId] =
    getObjectFromRedis[DataSourceId](redisKeyForDataSourceId(uploadId))

  def getDatasetIdByUploadId(uploadId: String): Fox[ObjectId] =
    getObjectFromRedis[ObjectId](redisKeyForDatasetId(uploadId))

  def reserveUpload(reserveUploadInfo: ReserveUploadInformation,
                    reserveUploadAdditionalInfo: ReserveAdditionalInformation): Fox[Unit] =
    for {
      _ <- dataSourceService.assertDataDirWritable(reserveUploadInfo.organization)
      _ <- Fox.fromBool(
        !reserveUploadInfo.needsConversion.getOrElse(false) || !reserveUploadInfo.layersToLink
          .exists(_.nonEmpty)) ?~> "Cannot use linked layers if the dataset needs conversion"
      _ <- runningUploadMetadataStore.insert(redisKeyForFileCount(reserveUploadInfo.uploadId),
                                             String.valueOf(reserveUploadInfo.totalFileCount))
      _ <- Fox.runOptional(reserveUploadInfo.totalFileSizeInBytes) { fileSize =>
        Fox.combined(
          List(
            runningUploadMetadataStore.insertLong(redisKeyForTotalFileSizeInBytes(reserveUploadInfo.uploadId),
                                                  fileSize),
            runningUploadMetadataStore
              .insertLong(redisKeyForCurrentUploadedTotalFileSizeInBytes(reserveUploadInfo.uploadId), 0L)
          ))
      }
      newDataSourceId = DataSourceId(reserveUploadAdditionalInfo.directoryName, reserveUploadInfo.organization)
      _ <- runningUploadMetadataStore.insert(
        redisKeyForDataSourceId(reserveUploadInfo.uploadId),
        Json.stringify(Json.toJson(newDataSourceId))
      )
      _ <- runningUploadMetadataStore.insert(
        redisKeyForDatasetId(reserveUploadInfo.uploadId),
        Json.stringify(Json.toJson(reserveUploadAdditionalInfo.newDatasetId))
      )
      _ <- runningUploadMetadataStore.insert(
        redisKeyForUploadId(DataSourceId(reserveUploadAdditionalInfo.directoryName, reserveUploadInfo.organization)),
        reserveUploadInfo.uploadId
      )
      filePaths = Json.stringify(Json.toJson(reserveUploadInfo.filePaths.getOrElse(List.empty)))
      _ <- runningUploadMetadataStore.insert(redisKeyForFilePaths(reserveUploadInfo.uploadId), filePaths)
      _ <- runningUploadMetadataStore.insert(
        redisKeyForLinkedLayerIdentifier(reserveUploadInfo.uploadId),
        Json.stringify(Json.toJson(LinkedLayerIdentifiers(reserveUploadInfo.layersToLink)))
      )
      _ = logger.info(
        f"Reserving ${uploadFullName(reserveUploadInfo.uploadId, reserveUploadAdditionalInfo.newDatasetId, newDataSourceId)}...")
    } yield ()

  def addUploadIdsToUnfinishedUploads(
      unfinishedUploadsWithoutIds: List[UnfinishedUpload]): Future[List[UnfinishedUpload]] =
    for {
      maybeUnfinishedUploads: List[Box[Option[UnfinishedUpload]]] <- Fox.sequence(
        // Previously rejected uploads may still appear in this list, but don’t have entries in redis. We can use that to filter them out here, since we don’t want to list them to the user. Those that *do* have entries in redis are then enriched using info from there (uploadId and filePaths).
        unfinishedUploadsWithoutIds.map(
          unfinishedUpload => {
            for {
              uploadIdOpt <- runningUploadMetadataStore.find(redisKeyForUploadId(unfinishedUpload.dataSourceId))
              updatedUploadOpt = uploadIdOpt.map(uploadId => unfinishedUpload.copy(uploadId = uploadId))
              updatedUploadWithFilePathsOpt <- Fox.runOptional(updatedUploadOpt)(updatedUpload =>
                for {
                  filePathsStringOpt <- runningUploadMetadataStore.find(redisKeyForFilePaths(updatedUpload.uploadId))
                  filePathsOpt <- filePathsStringOpt.map(JsonHelper.parseAs[List[String]]).toFox
                  uploadUpdatedWithFilePaths <- filePathsOpt
                    .map(filePaths => updatedUpload.copy(filePaths = Some(filePaths)))
                    .toFox
                } yield uploadUpdatedWithFilePaths)
            } yield updatedUploadWithFilePathsOpt
          }
        ))
      foundUnfinishedUploads = maybeUnfinishedUploads.flatten.flatten
    } yield foundUnfinishedUploads

  private def isOutsideUploadDir(uploadDir: Path, filePath: String): Boolean =
    uploadDir.relativize(uploadDir.resolve(filePath)).startsWith("../")

  private def getFilePathAndDirOfUploadId(uploadFileId: String): Fox[(String, Path)] = {
    val uploadId = extractDatasetUploadId(uploadFileId)
    for {
      dataSourceId <- getDataSourceIdByUploadId(uploadId)
      uploadDir = uploadDirectoryFor(dataSourceId.organizationId, uploadId)
      filePathRaw = uploadFileId.split("/").tail.mkString("/")
      filePath = if (filePathRaw.charAt(0) == '/') filePathRaw.drop(1) else filePathRaw
      _ <- Fox.fromBool(!isOutsideUploadDir(uploadDir, filePath)) ?~> s"Invalid file path: $filePath"
    } yield (filePath, uploadDir)
  }

  def isChunkPresent(uploadFileId: String, currentChunkNumber: Long): Fox[Boolean] = {
    val uploadId = extractDatasetUploadId(uploadFileId)
    for {
      (filePath, _) <- getFilePathAndDirOfUploadId(uploadFileId)
      isFileKnown <- runningUploadMetadataStore.contains(redisKeyForFileChunkCount(uploadId, filePath))
      isFilesChunkSetKnown <- Fox.runIf(isFileKnown)(
        runningUploadMetadataStore.contains(redisKeyForFileChunkSet(uploadId, filePath)))
      isChunkPresent <- Fox.runIf(isFileKnown)(
        runningUploadMetadataStore.isContainedInSet(redisKeyForFileChunkSet(uploadId, filePath),
                                                    String.valueOf(currentChunkNumber)))
    } yield isFileKnown && isFilesChunkSetKnown.getOrElse(false) && isChunkPresent.getOrElse(false)
  }

  def handleUploadChunk(uploadFileId: String,
                        chunkSize: Long,
                        currentChunkSize: Long,
                        totalChunkCount: Long,
                        currentChunkNumber: Long,
                        chunkFile: File): Fox[Unit] = {
    val uploadId = extractDatasetUploadId(uploadFileId)
    for {
      datasetId <- getDatasetIdByUploadId(uploadId)
      dataSourceId <- getDataSourceIdByUploadId(uploadId)
      (filePath, uploadDir) <- getFilePathAndDirOfUploadId(uploadFileId)
      isFileKnown <- runningUploadMetadataStore.contains(redisKeyForFileChunkCount(uploadId, filePath))
      totalFileSizeInBytesOpt <- runningUploadMetadataStore.findLong(redisKeyForTotalFileSizeInBytes(uploadId))
      _ <- Fox.runOptional(totalFileSizeInBytesOpt) { maxFileSize =>
        runningUploadMetadataStore
          .increaseBy(redisKeyForCurrentUploadedTotalFileSizeInBytes(uploadId), currentChunkSize)
          .flatMap(newTotalFileSizeInBytesOpt => {
            if (newTotalFileSizeInBytesOpt.getOrElse(0L) > maxFileSize) {
              cleanUpDatasetExceedingSize(uploadDir, uploadId).flatMap(_ =>
                Fox.failure("dataset.upload.moreBytesThanReserved"))
            } else {
              Fox.successful(())
            }
          })
      }
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
            val errorMsg =
              s"Error receiving chunk $currentChunkNumber for ${uploadFullName(uploadId, datasetId, dataSourceId)}: ${e.getMessage}"
            logger.warn(errorMsg)
            Fox.failure(errorMsg)
        }
      } else Fox.successful(())
  }

  def cancelUpload(cancelUploadInformation: CancelUploadInformation): Fox[Unit] = {
    val uploadId = cancelUploadInformation.uploadId
    for {
      dataSourceId <- getDataSourceIdByUploadId(uploadId)
      datasetId <- getDatasetIdByUploadId(uploadId)
      knownUpload <- isKnownUpload(uploadId)
    } yield
      if (knownUpload) {
        logger.info(f"Cancelling ${uploadFullName(uploadId, datasetId, dataSourceId)}...")
        for {
          _ <- removeFromRedis(uploadId)
          _ <- PathUtils.deleteDirectoryRecursively(uploadDirectoryFor(dataSourceId.organizationId, uploadId)).toFox
        } yield ()
      } else Fox.failure(s"Unknown upload")
  }

  private def uploadFullName(uploadId: String, datasetId: ObjectId, dataSourceId: DataSourceId) =
    s"upload $uploadId of dataset $datasetId ($dataSourceId)"

  private def assertWithinRequestedFileSizeAndCleanUpOtherwise(uploadDir: Path, uploadId: String): Fox[Unit] =
    for {
      totalFileSizeInBytesOpt <- runningUploadMetadataStore.find(redisKeyForTotalFileSizeInBytes(uploadId))
      _ <- Fox.runOptional(totalFileSizeInBytesOpt) { maxFileSize =>
        tryo(FileUtils.sizeOfDirectoryAsBigInteger(uploadDir.toFile).longValue).toFox.map(actualFileSize =>
          if (actualFileSize > maxFileSize.toLong) {
            cleanUpDatasetExceedingSize(uploadDir, uploadId)
            Fox.failure(s"Uploaded dataset exceeds the maximum allowed size of $maxFileSize bytes")
          } else Fox.successful(()))
      }
    } yield ()

  def finishUpload(uploadInformation: UploadInformation, datasetId: ObjectId)(implicit tc: TokenContext): Fox[Unit] = {
    val uploadId = uploadInformation.uploadId

    for {
      dataSourceId <- getDataSourceIdByUploadId(uploadId)
      _ = logger.info(s"Finishing ${uploadFullName(uploadId, datasetId, dataSourceId)}...")
      linkedLayerIdentifiers <- getObjectFromRedis[LinkedLayerIdentifiers](redisKeyForLinkedLayerIdentifier(uploadId))
      needsConversion = uploadInformation.needsConversion.getOrElse(false)
      uploadDir = uploadDirectoryFor(dataSourceId.organizationId, uploadId)
      _ <- backupRawUploadedData(uploadDir, uploadBackupDirectoryFor(dataSourceId.organizationId, uploadId), datasetId).toFox
      _ <- assertWithinRequestedFileSizeAndCleanUpOtherwise(uploadDir, uploadId)
      _ <- checkAllChunksUploaded(uploadId)
      unpackToDir = unpackToDirFor(dataSourceId)
      _ <- ensureDirectoryBox(unpackToDir.getParent).toFox ?~> "dataset.import.fileAccessDenied"
      unpackResult <- unpackDataset(uploadDir, unpackToDir, datasetId).shiftBox
      _ <- cleanUpUploadedDataset(uploadDir, uploadId)
      _ <- cleanUpOnFailure(unpackResult,
                            datasetId,
                            dataSourceId,
                            needsConversion,
                            label = s"unpacking to dataset to $unpackToDir")
      postProcessingResult <- exploreUploadedDataSourceIfNeeded(needsConversion, unpackToDir, dataSourceId).shiftBox
      _ <- cleanUpOnFailure(postProcessingResult,
                            datasetId,
                            dataSourceId,
                            needsConversion,
                            label = s"processing dataset at $unpackToDir")
      datasetSizeBytes <- tryo(FileUtils.sizeOfDirectoryAsBigInteger(new File(unpackToDir.toString)).longValue).toFox
      dataSourceWithAbsolutePathsOpt <- moveUnpackedToTarget(unpackToDir, needsConversion, datasetId, dataSourceId)

      _ <- remoteWebknossosClient.reportUpload(
        datasetId,
        ReportDatasetUploadParameters(
          uploadInformation.needsConversion.getOrElse(false),
          datasetSizeBytes,
          dataSourceWithAbsolutePathsOpt,
          linkedLayerIdentifiers.layersToLink.getOrElse(List.empty)
        )
      ) ?~> "reportUpload.failed"
    } yield ()
  }

  private def deleteFilesNotReferencedInDataSource(unpackedDir: Path, dataSource: UsableDataSource): Fox[Unit] =
    for {
      filesToDelete <- findNonReferencedFiles(unpackedDir, dataSource)
      _ = if (filesToDelete.nonEmpty)
        logger.info(s"Uploaded dataset contains files not referenced in the datasource. Deleting $filesToDelete...")
      _ = filesToDelete.foreach(file => {
        try {
          Files.deleteIfExists(file)
        } catch {
          case e: Exception =>
            logger.warn(s"Deletion failed for non-referenced file $file of uploaded dataset: ${e.getMessage}")
        }
      })
    } yield ()

  private def moveUnpackedToTarget(unpackedDir: Path,
                                   needsConversion: Boolean,
                                   datasetId: ObjectId,
                                   dataSourceId: DataSourceId): Fox[Option[UsableDataSource]] =
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
          dataSourceService.dataSourceFromDir(unpackedDir, dataSourceId.organizationId))
        usableDataSourceFromDir <- dataSourceFromDir.toUsable.toFox ?~> s"Invalid dataset uploaded: ${dataSourceFromDir.statusOpt
          .getOrElse("")}"
        _ <- deleteFilesNotReferencedInDataSource(unpackedDir, usableDataSourceFromDir)
        newBasePath <- if (dataStoreConfig.Datastore.S3Upload.enabled) {
          for {
            s3UploadBucket <- s3UploadBucketOpt.toFox
            _ = logger.info(s"finishUpload for $datasetId: Copying data to s3 bucket $s3UploadBucket...")
            beforeS3Upload = Instant.now
            s3ObjectKey = s"${dataStoreConfig.Datastore.S3Upload.objectKeyPrefix}/${dataSourceId.organizationId}/${dataSourceId.directoryName}/"
            _ <- uploadDirectoryToS3(unpackedDir, s3UploadBucket, s3ObjectKey)
            _ = Instant.logSince(beforeS3Upload,
                                 s"Forwarding of uploaded dataset $datasetId ($dataSourceId) to S3",
                                 logger)
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
        _ = this.synchronized {
          PathUtils.deleteDirectoryRecursively(unpackedDir)
        }
      } yield Some(dataSourceWithAdaptedPaths)
    }

  private def exploreUploadedDataSourceIfNeeded(needsConversion: Boolean,
                                                unpackToDir: Path,
                                                dataSourceId: DataSourceId): Fox[Unit] =
    if (needsConversion)
      Fox.successful(())
    else {
      for {
        _ <- Fox.successful(())
        uploadedDataSourceType = guessTypeOfUploadedDataSource(unpackToDir)
        _ <- uploadedDataSourceType match {
          case UploadedDataSourceType.ZARR | UploadedDataSourceType.NEUROGLANCER_PRECOMPUTED |
              UploadedDataSourceType.N5_MULTISCALES | UploadedDataSourceType.N5_ARRAY =>
            exploreLocalDatasource(unpackToDir, dataSourceId, uploadedDataSourceType)
          case UploadedDataSourceType.EXPLORED =>
            checkPathsInUploadedDatasourcePropertiesJson(unpackToDir, dataSourceId.organizationId)
          case UploadedDataSourceType.ZARR_MULTILAYER | UploadedDataSourceType.NEUROGLANCER_MULTILAYER |
              UploadedDataSourceType.N5_MULTILAYER =>
            tryExploringMultipleLayers(unpackToDir, dataSourceId, uploadedDataSourceType)
          case UploadedDataSourceType.WKW => addLayerAndMagDirIfMissing(unpackToDir).toFox
        }
      } yield ()
    }

  private def checkPathsInUploadedDatasourcePropertiesJson(unpackToDir: Path, organizationId: String): Fox[Unit] = {
    val dataSource = dataSourceService.dataSourceFromDir(unpackToDir, organizationId)
    for {
      _ <- Fox.runOptional(dataSource.toUsable)(
        usableDataSource =>
          Fox.fromBool(
            usableDataSource.allExplicitPaths.forall(remoteSourceDescriptorService.pathIsAllowedToAddDirectly)))
    } yield ()
  }

  private def exploreLocalDatasource(path: Path,
                                     dataSourceId: DataSourceId,
                                     typ: UploadedDataSourceType.Value): Fox[Unit] =
    for {
      _ <- Fox.runIf(typ == UploadedDataSourceType.ZARR)(addLayerAndMagDirIfMissing(path, FILENAME_DOT_ZARRAY).toFox)
      explored <- exploreLocalLayerService.exploreLocal(path, dataSourceId)
      _ <- exploreLocalLayerService.writeLocalDatasourceProperties(explored, path)
    } yield ()

  private def tryExploringMultipleLayers(path: Path,
                                         dataSourceId: DataSourceId,
                                         typ: UploadedDataSourceType.Value): Fox[Option[Path]] =
    for {
      layerDirs <- typ match {
        case UploadedDataSourceType.ZARR_MULTILAYER => getZarrLayerDirectories(path).toFox
        case UploadedDataSourceType.NEUROGLANCER_MULTILAYER | UploadedDataSourceType.N5_MULTILAYER =>
          PathUtils.listDirectories(path, silent = false).toFox
      }
      dataSources <- Fox.combined(
        layerDirs
          .map(layerDir =>
            for {
              _ <- addLayerAndMagDirIfMissing(layerDir).toFox
              explored: UsableDataSource <- exploreLocalLayerService.exploreLocal(path,
                                                                                  dataSourceId,
                                                                                  layerDir.getFileName.toString)
            } yield explored)
          .toList)
      combinedLayers = exploreLocalLayerService.makeLayerNamesUnique(dataSources.flatMap(_.dataLayers))
      firstExploredDatasource <- dataSources.headOption.toFox
      dataSource = UsableDataSource(dataSourceId, combinedLayers, firstExploredDatasource.scale)
      path <- Fox.runIf(combinedLayers.nonEmpty)(
        exploreLocalLayerService.writeLocalDatasourceProperties(dataSource, path))
    } yield path

  private lazy val s3UploadCredentialsOpt: Option[(String, String)] =
    dataStoreConfig.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
      new CredentialConfigReader(credentialConfig).getCredential
    }.collectFirst {
      case S3AccessKeyCredential(credentialName, accessKeyId, secretAccessKey, _, _)
          if dataStoreConfig.Datastore.S3Upload.credentialName == credentialName =>
        (accessKeyId, secretAccessKey)
    }

  private lazy val s3UploadBucketOpt: Option[String] =
    S3DataVault.hostBucketFromUri(new URI(dataStoreConfig.Datastore.S3Upload.credentialName))

  private lazy val s3UploadEndpoint: URI = {
    val credentialUri = new URI(dataStoreConfig.Datastore.S3Upload.credentialName)
    new URI(
      "https",
      null,
      credentialUri.getHost,
      -1,
      null,
      null,
      null
    )
  }

  private lazy val getS3TransferManager: Box[S3TransferManager] = for {
    accessKeyId <- Box(s3UploadCredentialsOpt.map(_._1))
    secretAccessKey <- Box(s3UploadCredentialsOpt.map(_._2))
    client <- tryo(
      S3AsyncClient
        .builder()
        .credentialsProvider(StaticCredentialsProvider.create(
          AwsBasicCredentials.builder.accessKeyId(accessKeyId).secretAccessKey(secretAccessKey).build()
        ))
        .crossRegionAccessEnabled(true)
        .forcePathStyle(true)
        .endpointOverride(s3UploadEndpoint)
        .region(Region.US_EAST_1)
        // Disabling checksum calculation prevents files being stored with Content Encoding "aws-chunked".
        .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
        .build())
  } yield S3TransferManager.builder().s3Client(client).build()

  private def uploadDirectoryToS3(
      dataDir: Path,
      bucketName: String,
      prefix: String
  ): Fox[Unit] =
    for {
      transferManager <- getS3TransferManager.toFox ?~> "S3 upload is not properly configured, cannot get S3 client"
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
      .flatMap(layer => layer.allExplicitPaths.flatMap(_.toLocalPath))
      .map(unpackedDir.resolve)
      .toSet
    val additionalMagPaths: Set[Path] = dataSource.dataLayers
      .flatMap(layer =>
        layer.mags.map(mag =>
          mag.path match {
            case Some(_) => None
            case None    => Some(unpackedDir.resolve(List(layer.name, mag.mag.toMagLiteral(true)).mkString("/")))
        }))
      .flatten
      .toSet

    val allReferencedPaths = explicitPaths ++ additionalMagPaths
    for {
      allFiles <- PathUtils.listFilesRecursive(unpackedDir, silent = true, maxDepth = 10).toFox
      filesToDelete = allFiles.filterNot(file => allReferencedPaths.exists(neededPath => file.startsWith(neededPath)))
    } yield filesToDelete
  }

  private def cleanUpOnFailure[T](result: Box[T],
                                  datasetId: ObjectId,
                                  dataSourceId: DataSourceId,
                                  needsConversion: Boolean,
                                  label: String): Fox[Unit] =
    result match {
      case Full(_) =>
        Fox.successful(())
      case Empty =>
        deleteOnDisk(dataSourceId.organizationId,
                     dataSourceId.directoryName,
                     None,
                     needsConversion,
                     Some("the upload failed"))
        Fox.failure(s"Unknown error $label")
      case Failure(msg, e, _) =>
        logger.warn(s"Error while $label: $msg, $e")
        deleteOnDisk(dataSourceId.organizationId,
                     dataSourceId.directoryName,
                     None,
                     needsConversion,
                     Some("the upload failed"))
        remoteWebknossosClient.deleteDataset(datasetId)
        for {
          _ <- result.toFox ?~> f"Error while $label"
        } yield ()
    }

  private def checkAllChunksUploaded(uploadId: String): Fox[Unit] =
    for {
      fileCountStringOpt <- runningUploadMetadataStore.find(redisKeyForFileCount(uploadId))
      fileCountString <- fileCountStringOpt.toFox ?~> "dataset.upload.noFiles"
      fileCount <- tryo(fileCountString.toLong).toFox
      fileNames <- runningUploadMetadataStore.findSet(redisKeyForFileNameSet(uploadId))
      _ <- Fox.fromBool(fileCount == fileNames.size)
      list <- Fox.serialCombined(fileNames.toList) { fileName =>
        val chunkCount =
          runningUploadMetadataStore
            .find(redisKeyForFileChunkCount(uploadId, fileName))
            .map(s => s.getOrElse("").toLong)
        val chunks = runningUploadMetadataStore.findSet(redisKeyForFileChunkSet(uploadId, fileName))
        chunks.flatMap(set => chunkCount.map(_ == set.size))
      }
      _ <- Fox.fromBool(list.forall(identity))
    } yield ()

  private def unpackToDirFor(dataSourceId: DataSourceId): Path =
    dataBaseDir
      .resolve(dataSourceId.organizationId)
      .resolve(uploadingDir)
      .resolve(unpackedDir)
      .resolve(dataSourceId.directoryName)

  private def guessTypeOfUploadedDataSource(dataSourceDir: Path): UploadedDataSourceType.Value =
    if (looksLikeExploredDataSource(dataSourceDir).getOrElse(false)) {
      UploadedDataSourceType.EXPLORED
    } else if (looksLikeZarrArray(dataSourceDir, maxDepth = 2).getOrElse(false)) {
      UploadedDataSourceType.ZARR
    } else if (looksLikeZarrArray(dataSourceDir, maxDepth = 3).getOrElse(false)) {
      UploadedDataSourceType.ZARR_MULTILAYER
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
      _ <- Box.fromBool(attributesFiles.nonEmpty)
      _ <- JsonHelper.parseAs[N5Metadata](Files.readAllBytes(attributesFiles.head))
    } yield true

  private def looksLikeN5Multilayer(dataSourceDir: Path): Box[Boolean] =
    for {
      matchingFileIsPresent <- containsMatchingFile(List(FILENAME_ATTRIBUTES_JSON), dataSourceDir, 1) // root attributes.json
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
      matchingFileIsPresent <- containsMatchingFile(List(FILENAME_ATTRIBUTES_JSON), dataSourceDir, 1) // root attributes.json
      _ <- Box.fromBool(matchingFileIsPresent)
      datasetDir <- PathUtils.listDirectories(dataSourceDir, silent = false).map(_.headOption)
      scaleDirs <- datasetDir.map(PathUtils.listDirectories(_, silent = false)).getOrElse(Full(Seq.empty))
      _ <- Box.fromBool(scaleDirs.length == 1) // Must be 1, otherwise it is a multiscale dataset
      attributesFiles <- PathUtils.listFilesRecursive(scaleDirs.head,
                                                      silent = false,
                                                      maxDepth = 1,
                                                      filters = p => p.getFileName.toString == FILENAME_ATTRIBUTES_JSON)
      _ <- JsonHelper.parseAs[N5Header](Files.readAllBytes(attributesFiles.head))
    } yield true

  private def looksLikeExploredDataSource(dataSourceDir: Path): Box[Boolean] =
    containsMatchingFile(List(FILENAME_DATASOURCE_PROPERTIES_JSON), dataSourceDir, 1)

  private def getZarrLayerDirectories(dataSourceDir: Path): Box[Seq[Path]] =
    for {
      potentialLayers <- PathUtils.listDirectories(dataSourceDir, silent = false)
      layerDirs = potentialLayers.filter(p => looksLikeZarrArray(p, maxDepth = 2).isDefined)
    } yield layerDirs

  private def addLayerAndMagDirIfMissing(dataSourceDir: Path, headerFile: String = FILENAME_HEADER_WKW): Box[Unit] =
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

  private def unpackDataset(uploadDir: Path, unpackToDir: Path, datasetId: ObjectId): Fox[Unit] =
    for {
      shallowFileList <- PathUtils.listFiles(uploadDir, silent = false).toFox
      excludeFromPrefix = LayerCategory.values.map(_.toString).toList
      firstFile = shallowFileList.headOption
      _ <- if (shallowFileList.length == 1 && shallowFileList.headOption.exists(
                 _.toString.toLowerCase.endsWith(".zip"))) {
        firstFile.toFox.flatMap { file =>
          logger.info(s"finishUpload for $datasetId: Unzipping dataset...")
          ZipIO
            .unzipToDirectory(
              new File(file.toString),
              unpackToDir,
              includeHiddenFiles = false,
              hiddenFilesWhitelist = List(".zarray", ".zattrs"),
              truncateCommonPrefix = true,
              Some(excludeFromPrefix)
            )
            .toFox
        }.map(_ => ())
      } else {
        for {
          deepFileList: List[Path] <- PathUtils.listFilesRecursive(uploadDir, silent = false, maxDepth = 10).toFox
          commonPrefixPreliminary = PathUtils.commonPrefix(deepFileList)
          strippedPrefix = PathUtils.cutOffPathAtLastOccurrenceOf(commonPrefixPreliminary, excludeFromPrefix)
          commonPrefix = PathUtils.removeSingleFileNameFromPrefix(strippedPrefix,
                                                                  deepFileList.map(_.getFileName.toString))
          _ <- tryo(FileUtils.moveDirectory(new File(commonPrefix.toString), new File(unpackToDir.toString))).toFox ?~> "dataset.upload.moveToTarget.failed"
        } yield ()
      }
    } yield ()

  private def backupRawUploadedData(uploadDir: Path, backupDir: Path, datasetId: ObjectId): Box[Unit] = {
    logger.info(s"finishUpload for $datasetId: Backing up raw uploaded data...")
    // Backed up within .trash (old files regularly deleted by cronjob)
    tryo(FileUtils.copyDirectory(uploadDir.toFile, backupDir.toFile))
  }

  private def cleanUpUploadedDataset(uploadDir: Path, uploadId: String): Fox[Unit] = {
    this.synchronized {
      PathUtils.deleteDirectoryRecursively(uploadDir)
    }
    removeFromRedis(uploadId)
  }

  private def cleanUpDatasetExceedingSize(uploadDir: Path, uploadId: String): Fox[Unit] =
    for {
      datasetId <- getDatasetIdByUploadId(uploadId)
      _ <- cleanUpUploadedDataset(uploadDir, uploadId)
      _ <- remoteWebknossosClient.deleteDataset(datasetId)
    } yield ()

  private def removeFromRedis(uploadId: String): Fox[Unit] =
    for {
      _ <- runningUploadMetadataStore.remove(redisKeyForFileCount(uploadId))
      fileNames <- runningUploadMetadataStore.findSet(redisKeyForFileNameSet(uploadId))
      _ <- Fox.serialCombined(fileNames.toList) { fileName =>
        for {
          _ <- runningUploadMetadataStore.remove(redisKeyForFileChunkCount(uploadId, fileName))
          _ <- runningUploadMetadataStore.remove(redisKeyForFileChunkSet(uploadId, fileName))
        } yield ()
      }
      _ <- runningUploadMetadataStore.remove(redisKeyForFileNameSet(uploadId))
      _ <- runningUploadMetadataStore.remove(redisKeyForTotalFileSizeInBytes(uploadId))
      _ <- runningUploadMetadataStore.remove(redisKeyForCurrentUploadedTotalFileSizeInBytes(uploadId))
      dataSourceId <- getDataSourceIdByUploadId(uploadId)
      _ <- runningUploadMetadataStore.remove(redisKeyForDataSourceId(uploadId))
      _ <- runningUploadMetadataStore.remove(redisKeyForDatasetId(uploadId))
      _ <- runningUploadMetadataStore.remove(redisKeyForLinkedLayerIdentifier(uploadId))
      _ <- runningUploadMetadataStore.remove(redisKeyForUploadId(dataSourceId))
      _ <- runningUploadMetadataStore.remove(redisKeyForFilePaths(uploadId))

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
      objectString <- objectStringOption.toFox
      parsed <- JsonHelper.parseAs[T](objectString).toFox
    } yield parsed

}

object UploadedDataSourceType extends Enumeration {
  val ZARR, EXPLORED, ZARR_MULTILAYER, WKW, NEUROGLANCER_PRECOMPUTED, NEUROGLANCER_MULTILAYER, N5_MULTISCALES,
  N5_MULTILAYER, N5_ARRAY = Value
}
