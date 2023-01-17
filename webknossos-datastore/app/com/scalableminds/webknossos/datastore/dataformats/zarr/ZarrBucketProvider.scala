package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.requestlogging.RateLimitedErrorLogging
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle, MagLocator}
import com.scalableminds.webknossos.datastore.datareaders.zarr.ZarrArray
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.FileSystemService
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo

import java.nio.file.Path
import scala.concurrent.ExecutionContext

class ZarrCubeHandle(zarrArray: ZarrArray) extends DataCubeHandle with LazyLogging with RateLimitedErrorLogging {

  def cutOutBucket(bucket: BucketPosition)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val shape = Vec3Int.full(bucket.bucketLength)
    val offset = Vec3Int(bucket.voxelXInMag, bucket.voxelYInMag, bucket.voxelZInMag)
    zarrArray.readBytesXYZ(shape, offset).recover {
      case t: Throwable => logError(t); Failure(t.getMessage, Full(t), Empty)
    }
  }

  override protected def onFinalize(): Unit = ()

}

class ZarrBucketProvider(layer: ZarrLayer, val fileSystemServiceOpt: Option[FileSystemService])
    extends BucketProvider
    with LazyLogging
    with RateLimitedErrorLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[ZarrCubeHandle] = {
    val zarrMagOpt: Option[MagLocator] =
      layer.mags.find(_.mag == readInstruction.bucket.mag)

    zarrMagOpt match {
      case None => Fox.empty
      case Some(zarrMag) =>
        fileSystemServiceOpt match {
          case Some(fileSystemService: FileSystemService) =>
            for {
              magPath: Path <- if (zarrMag.isRemote) {
                for {
                  remoteSource <- fileSystemService.remoteSourceFor(zarrMag)
                  remotePath <- remotePathFrom(remoteSource)
                } yield remotePath
              } else localPathFrom(readInstruction, zarrMag.pathWithFallback)
              cubeHandle <- tryo(onError = e => logError(e))(
                ZarrArray.open(magPath, zarrMag.axisOrder, zarrMag.channelIndex)).map(new ZarrCubeHandle(_))
            } yield cubeHandle
          case None => Empty
        }
    }
  }
}
