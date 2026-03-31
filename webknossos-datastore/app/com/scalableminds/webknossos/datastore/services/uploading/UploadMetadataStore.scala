package com.scalableminds.webknossos.datastore.services.uploading

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import play.api.libs.json.{Json, Reads, Writes}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class UploadMetadataStore @Inject()(metadataRedisStore: DataStoreRedisStore) extends FoxImplicits {
  // TODO parameterize this class by domain? (DS vs Mag vs Attachment?)

  /*
   * Redis stores different information for each running upload, with different prefixes in the keys.
   * Note that Redis synchronizes all db accesses, so we do not need to do it.
   */
  private def redisKeyForFileCount(uploadId: String): String =
    s"upload___${uploadId}___fileCount"

  private def redisKeyForTotalFileSizeInBytes(uploadId: String): String =
    s"upload___${uploadId}___totalFileSizeInBytes"

  private def redisKeyForFileNameSet(uploadId: String): String =
    s"upload___${uploadId}___fileNameSet"

  private def redisKeyForLinkedLayerIdentifier(uploadId: String): String =
    s"upload___${uploadId}___linkedLayerIdentifier"

  private def redisKeyForFileChunkCount(uploadId: String, fileName: String): String =
    s"upload___${uploadId}___file___${fileName}___chunkCount"

  private def redisKeyForFileChunkSet(uploadId: String, fileName: String): String =
    s"upload___${uploadId}___file___${fileName}___chunkSet"

  private def redisKeyForUploadIdByDataSourceId(datasourceId: DataSourceId): String =
    s"upload___${Json.stringify(Json.toJson(datasourceId))}___datasourceId"

  private def redisKeyForDataSourceId(uploadId: String): String =
    s"upload___${uploadId}___dataSourceId"

  private def redisKeyForDatasetId(uploadId: String): String =
    s"upload___${uploadId}___datasetId"

  private def redisKeyForFilePaths(uploadId: String): String =
    s"upload___${uploadId}___filePaths"

  def isKnownUpload(uploadId: String): Fox[Boolean] =
    metadataRedisStore.contains(redisKeyForFileCount(uploadId))

  def insertTotalFileCount(uploadId: String, totalFileCount: Long): Fox[Unit] =
    metadataRedisStore.insert(redisKeyForFileCount(uploadId), String.valueOf(totalFileCount))

  def insertTotalFileSizeInBytes(uploadId: String, totalFileSizeInBytes: Option[Long])(
      implicit ec: ExecutionContext): Fox[Option[Unit]] =
    Fox.runOptional(totalFileSizeInBytes) {
      metadataRedisStore.insertLong(redisKeyForTotalFileSizeInBytes(uploadId), _)
    }

  def insertLinkedLayerIdentifiers(uploadId: String, linkedLayerIdentifiers: Option[Seq[LinkedLayerIdentifier]])(
      implicit ec: ExecutionContext): Fox[_] =
    insertSerialized(redisKeyForLinkedLayerIdentifier(uploadId), linkedLayerIdentifiers.getOrElse(Seq.empty))

  def getDataSourceId(uploadId: String)(implicit ec: ExecutionContext): Fox[DataSourceId] =
    getParsed[DataSourceId](redisKeyForDataSourceId(uploadId))

  def getDatasetId(uploadId: String)(implicit ec: ExecutionContext): Fox[ObjectId] =
    getParsed[ObjectId](redisKeyForDatasetId(uploadId))

  // TODO make this Fox[String]?
  def getUploadIdByDataSourceId(dataSourceId: DataSourceId): Fox[Option[String]] =
    metadataRedisStore.find(redisKeyForUploadIdByDataSourceId(dataSourceId))

  def getFilePaths(uploadId: String)(implicit ec: ExecutionContext): Fox[Seq[String]] =
    getParsed[Seq[String]](redisKeyForFilePaths(uploadId))

  def isFileKnown(uploadId: String, filePath: String): Fox[Boolean] =
    metadataRedisStore.contains(redisKeyForFileChunkCount(uploadId, filePath))

  def isFileChunkSetKnown(uploadId: String, filePath: String): Fox[Boolean] =
    metadataRedisStore.contains(redisKeyForFileChunkSet(uploadId, filePath))

  def isChunkPresent(uploadId: String, filePath: String, chunkNumber: Long): Fox[Boolean] =
    metadataRedisStore.isContainedInSet(redisKeyForFileChunkSet(uploadId, filePath), String.valueOf(chunkNumber))

  def insertFilePathIntoSet(uploadId: String, filePath: String): Fox[Boolean] =
    metadataRedisStore.insertIntoSet(redisKeyForFileNameSet(uploadId), filePath)

  def insertFileChunkCount(uploadId: String, filePath: String, totalChunkCount: Long): Fox[Unit] =
    metadataRedisStore.insert(redisKeyForFileChunkCount(uploadId, filePath), String.valueOf(totalChunkCount))

  def insertFileChunkIntoSet(uploadId: String, filePath: String, chunkNumber: Long): Fox[Boolean] =
    metadataRedisStore.insertIntoSet(redisKeyForFileChunkSet(uploadId, filePath), String.valueOf(chunkNumber))

  def removeFileChunkFromSet(uploadId: String, filePath: String, chunkNumber: Long): Fox[Boolean] =
    metadataRedisStore.removeFromSet(redisKeyForFileChunkSet(uploadId, filePath), String.valueOf(chunkNumber))

  def insertDatasetId(uploadId: String, datasetId: ObjectId)(implicit ec: ExecutionContext): Fox[Unit] =
    insertSerialized(redisKeyForDatasetId(uploadId), datasetId)

  def insertDataSourceId(uploadId: String, dataSourceId: DataSourceId)(implicit ec: ExecutionContext): Fox[Unit] =
    insertSerialized(redisKeyForDataSourceId(uploadId), dataSourceId)

  // Only here the uploadId is not key but value. This is used to re-connect to unfinished uploads.
  def insertUploadIdByDataSourceId(dataSourceId: DataSourceId, uploadId: String)(
      implicit ec: ExecutionContext): Fox[Unit] =
    insertSerialized(redisKeyForUploadIdByDataSourceId(dataSourceId), uploadId)

  def insertFilePaths(uploadId: String, filePaths: Option[Seq[String]])(implicit ec: ExecutionContext): Fox[Unit] =
    insertSerialized(redisKeyForFilePaths(uploadId), filePaths.getOrElse(Seq.empty))

  def cleanUp(uploadId: String)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- metadataRedisStore.remove(redisKeyForFileCount(uploadId))
      fileNames <- metadataRedisStore.findSet(redisKeyForFileNameSet(uploadId))
      _ <- Fox.serialCombined(fileNames.toList) { fileName =>
        for {
          _ <- metadataRedisStore.remove(redisKeyForFileChunkCount(uploadId, fileName))
          _ <- metadataRedisStore.remove(redisKeyForFileChunkSet(uploadId, fileName))
        } yield ()
      }
      _ <- metadataRedisStore.remove(redisKeyForFileNameSet(uploadId))
      _ <- metadataRedisStore.remove(redisKeyForTotalFileSizeInBytes(uploadId))
      dataSourceId <- getDataSourceId(uploadId)
      _ <- metadataRedisStore.remove(redisKeyForDataSourceId(uploadId))
      _ <- metadataRedisStore.remove(redisKeyForDatasetId(uploadId))
      _ <- metadataRedisStore.remove(redisKeyForLinkedLayerIdentifier(uploadId))
      _ <- metadataRedisStore.remove(redisKeyForUploadIdByDataSourceId(dataSourceId))
      _ <- metadataRedisStore.remove(redisKeyForFilePaths(uploadId))
    } yield ()

  private def getParsed[T: Reads](key: String)(implicit ec: ExecutionContext): Fox[T] =
    for {
      objectStringOption <- metadataRedisStore.find(key)
      objectString <- objectStringOption.toFox
      parsed <- JsonHelper.parseAs[T](objectString).toFox
    } yield parsed

  private def insertSerialized[T: Writes](key: String, value: T)(implicit ec: ExecutionContext): Fox[Unit] = {
    val serialized = Json.stringify(Json.toJson(value))
    metadataRedisStore.insert(key, serialized)
  }

}
