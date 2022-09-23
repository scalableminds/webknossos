package com.scalableminds.webknossos.datastore.dataformats.zarr

import java.nio.file.Path
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.requestlogging.RateLimitedErrorLogging
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle, MagLocator}
import com.scalableminds.webknossos.datastore.datareaders.jzarr.ZarrArray
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo

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

class ZarrBucketProvider(layer: ZarrLayer) extends BucketProvider with LazyLogging with RateLimitedErrorLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[ZarrCubeHandle] = {
    val zarrMagOpt: Option[MagLocator] =
      layer.mags.find(_.mag == readInstruction.bucket.mag)

    zarrMagOpt match {
      case None => Empty
      case Some(zarrMag) => {
        val magPathOpt: Option[Path] =
          zarrMag.remoteSource match {
            case Some(remoteSource) => remotePathFrom(remoteSource)
            case None               => localPathFrom(readInstruction, zarrMag.pathWithFallback)
          }
        magPathOpt match {
          case None => Empty
          case Some(magPath) =>
            tryo(onError = e => logError(e))(ZarrArray.open(magPath, zarrMag.axisOrder)).map(new ZarrCubeHandle(_))
        }
      }
    }

  }
}
