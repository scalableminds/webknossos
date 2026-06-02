package com.scalableminds.webknossos.datastore.services.uploading

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.LayerAttachmentType.LayerAttachmentType
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, LayerAttachment}
import com.scalableminds.webknossos.datastore.services.uploading.UploadDomain.UploadDomain
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import play.api.libs.json.Json

import javax.inject.Inject
import scala.concurrent.ExecutionContext

trait UploadMetadataStore extends FoxImplicits {

  protected def domain: UploadDomain
  protected def store: DataStoreRedisStore

  protected def keyPrefix = s"upload___${domain}___"

  /*
   * Redis stores different information for each running upload, with different prefixes in the keys.
   * Note that Redis synchronizes all db accesses, so we do not need to do it.
   */
  private def redisKeyForFileCount(uploadId: String): String =
    s"$keyPrefix${uploadId}___fileCount"

  private def redisKeyForTotalFileSizeInBytes(uploadId: String): String =
    s"$keyPrefix${uploadId}___totalFileSizeInBytes"

  private def redisKeyForFileNameSet(uploadId: String): String =
    s"$keyPrefix${uploadId}___fileNameSet"

  private def redisKeyForFileChunkCount(uploadId: String, fileName: String): String =
    s"$keyPrefix${uploadId}___file___${fileName}___chunkCount"

  private def redisKeyForFileChunkSet(uploadId: String, fileName: String): String =
    s"$keyPrefix${uploadId}___file___${fileName}___chunkSet"

  private def redisKeyForDataSourceId(uploadId: String): String =
    s"$keyPrefix${uploadId}___dataSourceId"

  private def redisKeyForDatasetId(uploadId: String): String =
    s"$keyPrefix${uploadId}___datasetId"

  private def redisKeyForFilePaths(uploadId: String): String =
    s"$keyPrefix${uploadId}___filePaths"

  def isKnownUpload(uploadId: String): Fox[Boolean] =
    store.contains(redisKeyForFileCount(uploadId))

  def findDataSourceId(uploadId: String)(implicit ec: ExecutionContext): Fox[DataSourceId] =
    store.findParsed[DataSourceId](redisKeyForDataSourceId(uploadId))

  def findDatasetId(uploadId: String)(implicit ec: ExecutionContext): Fox[ObjectId] =
    store.findParsed[ObjectId](redisKeyForDatasetId(uploadId))

  def findFilePaths(uploadId: String)(implicit ec: ExecutionContext): Fox[Seq[String]] =
    store.findParsed[Seq[String]](redisKeyForFilePaths(uploadId))

  def findTotalFileSizeInBytes(uploadId: String): Fox[Long] =
    store.findLong(redisKeyForTotalFileSizeInBytes(uploadId))

  def findFileCount(uploadId: String): Fox[Long] =
    store.findLong(redisKeyForFileCount(uploadId))

  def findFileNames(uploadId: String): Fox[Set[String]] =
    store.findSet(redisKeyForFileNameSet(uploadId))

  def findFileChunkCount(uploadId: String, filePath: String): Fox[Long] =
    store.findLong(redisKeyForFileChunkCount(uploadId, filePath))

  def findFileChunkSet(uploadId: String, filePath: String): Fox[Set[String]] =
    store.findSet(redisKeyForFileChunkSet(uploadId, filePath))

  def isFileKnown(uploadId: String, filePath: String): Fox[Boolean] =
    store.contains(redisKeyForFileChunkCount(uploadId, filePath))

  def isFileChunkSetKnown(uploadId: String, filePath: String): Fox[Boolean] =
    store.contains(redisKeyForFileChunkSet(uploadId, filePath))

  def isChunkPresent(uploadId: String, filePath: String, chunkNumber: Long): Fox[Boolean] =
    store.isContainedInSet(redisKeyForFileChunkSet(uploadId, filePath), String.valueOf(chunkNumber))

  def insertTotalFileCount(uploadId: String, totalFileCount: Long): Fox[Unit] =
    store.insert(redisKeyForFileCount(uploadId), String.valueOf(totalFileCount))

  def insertTotalFileSizeInBytes(uploadId: String, totalFileSizeInBytes: Option[Long])(
      implicit ec: ExecutionContext): Fox[Option[Unit]] =
    Fox.runOptional(totalFileSizeInBytes) {
      store.insertLong(redisKeyForTotalFileSizeInBytes(uploadId), _)
    }

  def insertFilePathIntoSet(uploadId: String, filePath: String): Fox[Boolean] =
    store.insertIntoSet(redisKeyForFileNameSet(uploadId), filePath)

  def insertFileChunkCount(uploadId: String, filePath: String, totalChunkCount: Long): Fox[Unit] =
    store.insert(redisKeyForFileChunkCount(uploadId, filePath), String.valueOf(totalChunkCount))

  def insertFileChunkIntoSet(uploadId: String, filePath: String, chunkNumber: Long): Fox[Boolean] =
    store.insertIntoSet(redisKeyForFileChunkSet(uploadId, filePath), String.valueOf(chunkNumber))

  def removeFileChunkFromSet(uploadId: String, filePath: String, chunkNumber: Long): Fox[Boolean] =
    store.removeFromSet(redisKeyForFileChunkSet(uploadId, filePath), String.valueOf(chunkNumber))

  def insertDatasetId(uploadId: String, datasetId: ObjectId): Fox[Unit] =
    store.insertSerialized(redisKeyForDatasetId(uploadId), datasetId)

  def insertDataSourceId(uploadId: String, dataSourceId: DataSourceId): Fox[Unit] =
    store.insertSerialized(redisKeyForDataSourceId(uploadId), dataSourceId)

  def insertFilePaths(uploadId: String, filePaths: Option[Seq[String]]): Fox[Unit] =
    store.insertSerialized(redisKeyForFilePaths(uploadId), filePaths.getOrElse(Seq.empty))

  def cleanUp(uploadId: String)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- store.remove(redisKeyForFileCount(uploadId))
      fileNames <- store.findSet(redisKeyForFileNameSet(uploadId))
      _ <- Fox.serialCombined(fileNames.toList) { fileName =>
        for {
          _ <- store.remove(redisKeyForFileChunkCount(uploadId, fileName))
          _ <- store.remove(redisKeyForFileChunkSet(uploadId, fileName))
        } yield ()
      }
      _ <- store.remove(redisKeyForFileNameSet(uploadId))
      _ <- store.remove(redisKeyForTotalFileSizeInBytes(uploadId))
      _ <- store.remove(redisKeyForDataSourceId(uploadId))
      _ <- store.remove(redisKeyForDatasetId(uploadId))
      _ <- store.remove(redisKeyForFilePaths(uploadId))
    } yield ()

}

class DatasetUploadMetadataStore @Inject()(protected val store: DataStoreRedisStore) extends UploadMetadataStore {
  protected val domain: UploadDomain = UploadDomain.dataset

  private def redisKeyForUploadIdByDataSourceId(datasourceId: DataSourceId): String =
    s"${keyPrefix}___${Json.stringify(Json.toJson(datasourceId))}___datasourceId"

  private def redisKeyForLinkedLayerIdentifier(uploadId: String): String =
    s"$keyPrefix${uploadId}___linkedLayerIdentifier"

  private def redisKeyForNeedsConversion(uploadId: String): String =
    s"$keyPrefix${uploadId}___needsConversion"

  private def redisKeyForVoxelSize(uploadId: String): String =
    s"$keyPrefix${uploadId}___voxelSize"

  def findUploadIdByDataSourceId(dataSourceId: DataSourceId): Fox[String] =
    store.find(redisKeyForUploadIdByDataSourceId(dataSourceId))

  def findLinkedLayerIdentifiers(uploadId: String)(implicit ec: ExecutionContext): Fox[Seq[LinkedLayerIdentifier]] =
    store.findParsed[Seq[LinkedLayerIdentifier]](redisKeyForLinkedLayerIdentifier(uploadId))

  def findNeedsConversion(uploadId: String)(implicit ec: ExecutionContext): Fox[Boolean] =
    store.findParsed[Boolean](redisKeyForNeedsConversion(uploadId))

  def findVoxelSize(uploadId: String)(implicit ec: ExecutionContext): Fox[VoxelSize] =
    store.findParsed[VoxelSize](redisKeyForVoxelSize(uploadId))

  // Only here the uploadId is not key but value. This is used to re-connect to unfinished uploads.
  def insertUploadIdByDataSourceId(dataSourceId: DataSourceId, uploadId: String): Fox[Unit] =
    store.insertSerialized(redisKeyForUploadIdByDataSourceId(dataSourceId), uploadId)

  def insertLinkedLayerIdentifiers(uploadId: String,
                                   linkedLayerIdentifiers: Option[Seq[LinkedLayerIdentifier]]): Fox[_] =
    store.insertSerialized(redisKeyForLinkedLayerIdentifier(uploadId), linkedLayerIdentifiers.getOrElse(Seq.empty))

  def insertNeedsConversion(uploadId: String, needsConversion: Boolean): Fox[_] =
    store.insertSerialized(redisKeyForNeedsConversion(uploadId), needsConversion)

  def insertVoxelSize(uploadId: String, voxelSize: VoxelSize): Fox[_] =
    store.insertSerialized(redisKeyForVoxelSize(uploadId), voxelSize)

  override def cleanUp(uploadId: String)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      dataSourceId <- findDataSourceId(uploadId)
      _ <- store.remove(redisKeyForLinkedLayerIdentifier(uploadId))
      _ <- store.remove(redisKeyForNeedsConversion(uploadId))
      _ <- store.remove(redisKeyForUploadIdByDataSourceId(dataSourceId))
      _ <- super.cleanUp(uploadId)
    } yield ()

}

class MagUploadMetadataStore @Inject()(protected val store: DataStoreRedisStore) extends UploadMetadataStore {
  protected val domain: UploadDomain = UploadDomain.mag

  private def redisKeyForMag(uploadId: String): String =
    s"$keyPrefix${uploadId}___mag"

  private def redisKeyForLayerName(uploadId: String): String =
    s"$keyPrefix${uploadId}___layerName"

  def insertMag(uploadId: String, mag: MagLocator): Fox[Unit] =
    store.insertSerialized[MagLocator](redisKeyForMag(uploadId), mag)

  def insertLayerName(uploadId: String, layerName: String): Fox[Unit] =
    store.insert(redisKeyForLayerName(uploadId), layerName)

  def findMag(uploadId: String)(implicit ec: ExecutionContext): Fox[MagLocator] =
    store.findParsed[MagLocator](redisKeyForMag(uploadId))

  def findLayerName(uploadId: String): Fox[String] =
    store.find(redisKeyForLayerName(uploadId))

  override def cleanUp(uploadId: String)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- store.remove(redisKeyForMag(uploadId))
      _ <- store.remove(redisKeyForLayerName(uploadId))
      _ <- super.cleanUp(uploadId)
    } yield ()
}

class AttachmentUploadMetadataStore @Inject()(protected val store: DataStoreRedisStore) extends UploadMetadataStore {
  protected val domain: UploadDomain = UploadDomain.attachment

  private def redisKeyForAttachment(uploadId: String): String =
    s"$keyPrefix${uploadId}___attachment"

  private def redisKeyForAttachmentType(uploadId: String): String =
    s"$keyPrefix${uploadId}___attachmentType"

  private def redisKeyForLayerName(uploadId: String): String =
    s"$keyPrefix${uploadId}___layerName"

  def insertAttachment(uploadId: String, attachment: LayerAttachment): Fox[Unit] =
    store.insertSerialized[LayerAttachment](redisKeyForAttachment(uploadId), attachment)

  def insertAttachmentType(uploadId: String, attachmentType: LayerAttachmentType): Fox[Unit] =
    store.insertSerialized[LayerAttachmentType](redisKeyForAttachmentType(uploadId), attachmentType)

  def insertLayerName(uploadId: String, layerName: String): Fox[Unit] =
    store.insert(redisKeyForLayerName(uploadId), layerName)

  def findAttachment(uploadId: String)(implicit ec: ExecutionContext): Fox[LayerAttachment] =
    store.findParsed[LayerAttachment](redisKeyForAttachment(uploadId))

  def findAttachmentType(uploadId: String)(implicit ec: ExecutionContext): Fox[LayerAttachmentType] =
    store.findParsed[LayerAttachmentType](redisKeyForAttachmentType(uploadId))

  def findLayerName(uploadId: String): Fox[String] =
    store.find(redisKeyForLayerName(uploadId))

  override def cleanUp(uploadId: String)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- store.remove(redisKeyForAttachmentType(uploadId))
      _ <- store.remove(redisKeyForAttachment(uploadId))
      _ <- store.remove(redisKeyForLayerName(uploadId))
      _ <- super.cleanUp(uploadId)
    } yield ()
}
