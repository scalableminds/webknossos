package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle, MagLocator}
import com.scalableminds.webknossos.datastore.datareaders.zarr.ZarrArray
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Empty
import ucar.ma2.{Array => MultiArray}

import scala.concurrent.ExecutionContext

class ZarrCubeHandle(zarrArray: ZarrArray) extends DataCubeHandle with LazyLogging {

  def cutOutBucket(bucket: BucketPosition, dataLayer: DataLayer)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val size = Vec3Int.full(bucket.bucketLength)
    val offset = Vec3Int(bucket.topLeft.voxelXInMag, bucket.topLeft.voxelYInMag, bucket.topLeft.voxelZInMag)

    bucket.additionalCoordinates match {
      case Some(additionalCoordinates) if additionalCoordinates.nonEmpty =>
        zarrArray.readBytesWithAdditionalCoordinates(size, offset, additionalCoordinates, dataLayer.additionalAxisMap)
      case _ => zarrArray.readBytesXYZ(size, offset, dataLayer.elementClass == ElementClass.uint24)
    }
  }

  override protected def onFinalize(): Unit = ()

}

class ZarrBucketProvider(layer: ZarrLayer,
                         dataSourceId: DataSourceId,
                         val remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                         sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]])
    extends BucketProvider
    with LazyLogging {

  override def openShardOrArrayHandle(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[ZarrCubeHandle] = {
    val magLocatorOpt: Option[MagLocator] =
      layer.mags.find(_.mag == readInstruction.bucket.mag)

    magLocatorOpt match {
      case None => Fox.empty
      case Some(magLocator) =>
        remoteSourceDescriptorServiceOpt match {
          case Some(remoteSourceDescriptorService: RemoteSourceDescriptorService) =>
            for {
              magPath: VaultPath <- remoteSourceDescriptorService.vaultPathFor(readInstruction.baseDir,
                                                                               readInstruction.dataSource.id,
                                                                               readInstruction.dataLayer.name,
                                                                               magLocator)
              chunkContentsCache <- sharedChunkContentsCache.toFox
              cubeHandle <- ZarrArray
                .open(magPath,
                      dataSourceId,
                      layer.name,
                      magLocator.axisOrder,
                      magLocator.channelIndex,
                      chunkContentsCache)
                .map(new ZarrCubeHandle(_))
            } yield cubeHandle
          case None => Empty
        }
    }
  }

}
