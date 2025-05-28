package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Array
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedArray
import com.scalableminds.webknossos.datastore.datareaders.wkw.WKWArray
import com.scalableminds.webknossos.datastore.datareaders.zarr.ZarrArray
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.{DataFormat, DataLayer, DataSourceId, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.typesafe.scalalogging.LazyLogging

import scala.concurrent.duration._
import ucar.ma2.{Array => MultiArray}

import scala.concurrent.ExecutionContext

class DatasetArrayBucketProvider(dataLayer: DataLayer,
                                 dataSourceId: DataSourceId,
                                 remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                                 sharedChunkContentsCacheOpt: Option[AlfuCache[String, MultiArray]])
    extends BucketProvider
    with FoxImplicits
    with LazyLogging {

  // Cache the DatasetArrays of all mags of this layer
  private lazy val datasetArrayCache = AlfuCache[Vec3Int, DatasetArray](maxCapacity = 50)

  def load(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      datasetArray <- datasetArrayCache.getOrLoad(readInstruction.bucket.mag,
                                                  _ => openDatasetArrayWithTimeLogging(readInstruction))
      bucket = readInstruction.bucket
      shape = Vec3Int.full(bucket.bucketLength)
      offset = Vec3Int(bucket.topLeft.voxelXInMag, bucket.topLeft.voxelYInMag, bucket.topLeft.voxelZInMag)
      bucketData <- datasetArray.readBytesWithAdditionalCoordinates(offset,
                                                                    shape,
                                                                    bucket.additionalCoordinates,
                                                                    dataLayer.elementClass == ElementClass.uint24)
    } yield bucketData

  private def openDatasetArrayWithTimeLogging(
      readInstruction: DataReadInstruction)(implicit ec: ExecutionContext, tc: TokenContext): Fox[DatasetArray] = {
    val before = Instant.now
    val result = openDatasetArray(readInstruction)
    result.onComplete { _ =>
      val duration = Instant.since(before)
      if (duration > (1 second)) {
        logger.warn(
          s"Opening ${dataLayer.dataFormat} DatasetArray for ${readInstruction.layerSummary} was slow ($duration)"
        )
      }
    }
    result
  }

  private def openDatasetArray(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext,
                                                                     tc: TokenContext): Fox[DatasetArray] = {
    val magLocatorOpt: Option[MagLocator] =
      dataLayer.mags.find(_.mag == readInstruction.bucket.mag)

    magLocatorOpt match {
      case None => Fox.empty
      case Some(magLocator) =>
        remoteSourceDescriptorServiceOpt match {
          case Some(remoteSourceDescriptorService: RemoteSourceDescriptorService) =>
            for {
              magPath: VaultPath <- remoteSourceDescriptorService.vaultPathFor(readInstruction.baseDir,
                                                                               readInstruction.dataSourceId,
                                                                               readInstruction.dataLayer.name,
                                                                               magLocator)
              chunkContentsCache <- sharedChunkContentsCacheOpt.toFox
              datasetArray <- dataLayer.dataFormat match {
                case DataFormat.zarr =>
                  ZarrArray.open(magPath,
                                 dataSourceId,
                                 dataLayer.name,
                                 magLocator.axisOrder,
                                 magLocator.channelIndex,
                                 dataLayer.additionalAxes,
                                 chunkContentsCache)
                case DataFormat.wkw =>
                  WKWArray.open(magPath, dataSourceId, dataLayer.name, chunkContentsCache)
                case DataFormat.n5 =>
                  N5Array.open(magPath,
                               dataSourceId,
                               dataLayer.name,
                               magLocator.axisOrder,
                               magLocator.channelIndex,
                               dataLayer.additionalAxes,
                               chunkContentsCache)
                case DataFormat.zarr3 =>
                  Zarr3Array.open(magPath,
                                  dataSourceId,
                                  dataLayer.name,
                                  magLocator.axisOrder,
                                  magLocator.channelIndex,
                                  dataLayer.additionalAxes,
                                  chunkContentsCache)
                case DataFormat.neuroglancerPrecomputed =>
                  PrecomputedArray.open(magPath,
                                        dataSourceId,
                                        dataLayer.name,
                                        magLocator.axisOrder,
                                        magLocator.channelIndex,
                                        dataLayer.additionalAxes,
                                        chunkContentsCache)
                case _ => Fox.failure(s"Cannot open ${dataLayer.dataFormat} layer “${dataLayer.name}” as DatasetArray")
              }
            } yield datasetArray
          case None => Fox.empty
        }
    }
  }

}
