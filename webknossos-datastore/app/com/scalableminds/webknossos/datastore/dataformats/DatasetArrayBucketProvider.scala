package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.typesafe.scalalogging.LazyLogging
import ucar.ma2.{Array => MultiArray}

import scala.concurrent.ExecutionContext

abstract class DatasetArrayBucketProvider(dataLayer: DataLayer,
                                          dataSourceId: DataSourceId,
                                          val remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                                          sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]])
    extends AbstractBucketProvider
    with LazyLogging {

  // by mag
  private lazy val arrayHandleCache = AlfuCache[Vec3Int, DatasetArray](maxCapacity = 50)

  def load(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      datasetArray <- arrayHandleCache.getOrLoad(readInstruction.bucket.mag,
                                                 _ => openDatasetArrayHandleWithTimeout(readInstruction))
      bucket = readInstruction.bucket
      shape = Vec3Int.full(bucket.bucketLength)
      offset = Vec3Int(bucket.topLeft.voxelXInMag, bucket.topLeft.voxelYInMag, bucket.topLeft.voxelZInMag)
      bucketData <- datasetArray.readBytesWithAdditionalCoordinates(shape,
                                                                    offset,
                                                                    bucket.additionalCoordinates,
                                                                    dataLayer.elementClass == ElementClass.uint24)
    } yield bucketData

  private def openDatasetArrayHandleWithTimeout(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[DatasetArray] = {
    val t = System.currentTimeMillis
    for {
      result <- openDatasetArrayHandle(readInstruction).futureBox
      duration = System.currentTimeMillis - t
      _ = if (duration > 500) {
        val className = this.getClass.getName.split("\\.").last
        logger.warn(
          s"Opening file in $className took ${if (duration > 3000) "really " else ""}long.\n"
            + s"  duration: $duration ms\n"
            + s"  dataSource: ${readInstruction.dataSource.id.name}\n"
            + s"  dataLayer: ${readInstruction.dataLayer.name}\n"
            + s"  cube: ${readInstruction.cube}"
        )
      }
    } yield result
  }

  def openDatasetArrayHandle(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext): Fox[DatasetArray]

}
