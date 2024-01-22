package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle, MagLocator}
import com.scalableminds.webknossos.datastore.datareaders.wkw.WKWArray
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Empty
import ucar.ma2.{Array => MultiArray}

import scala.concurrent.ExecutionContext

class WKWCubeHandle(wkwArray: WKWArray) extends DataCubeHandle with LazyLogging {

  def cutOutBucket(bucket: BucketPosition, dataLayer: DataLayer)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val shape = Vec3Int.full(bucket.bucketLength)
    val offset = Vec3Int(bucket.topLeft.voxelXInMag, bucket.topLeft.voxelYInMag, bucket.topLeft.voxelZInMag)
    wkwArray.readBytesXYZ(shape, offset, dataLayer.elementClass == ElementClass.uint24)
  }

  override protected def onFinalize(): Unit = ()

}

class WKWBucketProvider(layer: WKWLayer,
                        dataSourceId: DataSourceId,
                        val remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                        sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]])
    extends BucketProvider
    with LazyLogging {

  override def openShardOrArrayHandle(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[WKWCubeHandle] = {
    val magLocatorOpt: Option[MagLocator] =
      layer.wkwResolutions.find(_.resolution == readInstruction.bucket.mag).map(wkwResolutionToMagLocator)

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
              cubeHandle <- WKWArray
                .open(magPath, dataSourceId, layer.name, chunkContentsCache)
                .map(new WKWCubeHandle(_))
            } yield cubeHandle
          case None => Empty
        }
    }
  }

  private def wkwResolutionToMagLocator(wkwResolution: WKWResolution): MagLocator =
    MagLocator(wkwResolution.resolution)

}
