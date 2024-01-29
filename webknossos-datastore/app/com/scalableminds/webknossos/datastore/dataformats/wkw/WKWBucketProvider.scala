package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DatasetArrayHandle, MagLocator}
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

class WKWBucketProvider(layer: WKWLayer,
                        dataSourceId: DataSourceId,
                        val remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                        sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]])
    extends BucketProvider
    with LazyLogging {

  override def openDatasetArrayHandle(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[DatasetArrayHandle] = {
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
                .map(new DatasetArrayHandle(_))
            } yield cubeHandle
          case None => Empty
        }
    }
  }

  private def wkwResolutionToMagLocator(wkwResolution: WKWResolution): MagLocator =
    MagLocator(wkwResolution.resolution)

}
