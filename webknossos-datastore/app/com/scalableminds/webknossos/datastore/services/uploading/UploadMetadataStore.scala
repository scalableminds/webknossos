package com.scalableminds.webknossos.datastore.services.uploading

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import play.api.libs.json.Json

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class UploadMetadataStore @Inject()(store: DataStoreRedisStore) extends FoxImplicits {
  // TODO parameterize this class by domain? (DS vs Mag vs Attachment?) or even make it trait with three implementations?

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
    store.contains(redisKeyForFileCount(uploadId))

  def insertTotalFileCount(uploadId: String, totalFileCount: Long): Fox[Unit] =
    store.insert(redisKeyForFileCount(uploadId), String.valueOf(totalFileCount))

  def insertTotalFileSizeInBytes(uploadId: String, totalFileSizeInBytes: Option[Long])(
      implicit ec: ExecutionContext): Fox[Option[Unit]] =
    Fox.runOptional(totalFileSizeInBytes) {
      store.insertLong(redisKeyForTotalFileSizeInBytes(uploadId), _)
    }

  def insertLinkedLayerIdentifiers(uploadId: String,
                                   linkedLayerIdentifiers: Option[Seq[LinkedLayerIdentifier]]): Fox[_] =
    store.insertSerialized(redisKeyForLinkedLayerIdentifier(uploadId), linkedLayerIdentifiers.getOrElse(Seq.empty))

  def getDataSourceId(uploadId: String)(implicit ec: ExecutionContext): Fox[DataSourceId] =
    store.findParsed[DataSourceId](redisKeyForDataSourceId(uploadId))

  def getDatasetId(uploadId: String)(implicit ec: ExecutionContext): Fox[ObjectId] =
    store.findParsed[ObjectId](redisKeyForDatasetId(uploadId))

  // TODO make this Fox[String]?
  def getUploadIdByDataSourceId(dataSourceId: DataSourceId): Fox[Option[String]] =
    store.find(redisKeyForUploadIdByDataSourceId(dataSourceId))

  def getFilePaths(uploadId: String)(implicit ec: ExecutionContext): Fox[Seq[String]] =
    store.findParsed[Seq[String]](redisKeyForFilePaths(uploadId))

  def getLinkedLayerIdentifiers(uploadId: String)(implicit ec: ExecutionContext): Fox[Seq[LinkedLayerIdentifier]] =
    store.findParsed[Seq[LinkedLayerIdentifier]](redisKeyForLinkedLayerIdentifier(uploadId))

  // TODO make this Fox[Long]?
  def getTotalFileSizeInBytes(uploadId: String): Fox[Option[Long]] =
    store.findLong(redisKeyForTotalFileSizeInBytes(uploadId))

  def getFileCount(uploadId: String): Fox[Option[Long]] =
    store.findLong(redisKeyForFileCount(uploadId))

  def getFileNames(uploadId: String): Fox[Set[String]] =
    store.findSet(redisKeyForFileNameSet(uploadId))

  def getFileChunkCount(uploadId: String, filePath: String): Fox[Option[Long]] =
    store.findLong(redisKeyForFileChunkCount(uploadId, filePath))

  def getFileChunkSet(uploadId: String, filePath: String): Fox[Set[String]] =
    store.findSet(redisKeyForFileChunkSet(uploadId, filePath))

  def isFileKnown(uploadId: String, filePath: String): Fox[Boolean] =
    store.contains(redisKeyForFileChunkCount(uploadId, filePath))

  def isFileChunkSetKnown(uploadId: String, filePath: String): Fox[Boolean] =
    store.contains(redisKeyForFileChunkSet(uploadId, filePath))

  def isChunkPresent(uploadId: String, filePath: String, chunkNumber: Long): Fox[Boolean] =
    store.isContainedInSet(redisKeyForFileChunkSet(uploadId, filePath), String.valueOf(chunkNumber))

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

  // Only here the uploadId is not key but value. This is used to re-connect to unfinished uploads.
  def insertUploadIdByDataSourceId(dataSourceId: DataSourceId, uploadId: String): Fox[Unit] =
    store.insertSerialized(redisKeyForUploadIdByDataSourceId(dataSourceId), uploadId)

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
      dataSourceId <- getDataSourceId(uploadId)
      _ <- store.remove(redisKeyForDataSourceId(uploadId))
      _ <- store.remove(redisKeyForDatasetId(uploadId))
      _ <- store.remove(redisKeyForLinkedLayerIdentifier(uploadId))
      _ <- store.remove(redisKeyForUploadIdByDataSourceId(dataSourceId))
      _ <- store.remove(redisKeyForFilePaths(uploadId))
    } yield ()

}
