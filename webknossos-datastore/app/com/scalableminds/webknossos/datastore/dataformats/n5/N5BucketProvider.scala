package com.scalableminds.webknossos.datastore.dataformats.n5

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.requestlogging.RateLimitedErrorLogging
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle, MagLocator}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Array
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo

import java.nio.file.Path
import scala.concurrent.ExecutionContext

class N5CubeHandle(n5Array: N5Array) extends DataCubeHandle with LazyLogging with RateLimitedErrorLogging {

  def cutOutBucket(bucket: BucketPosition)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val shape = Vec3Int.full(bucket.bucketLength)
    val offset = Vec3Int(bucket.voxelXInMag, bucket.voxelYInMag, bucket.voxelZInMag)
    n5Array.readBytesXYZ(shape, offset).recover {
      case t: Throwable => logError(t); Failure(t.getMessage, Full(t), Empty)
    }
  }

  override protected def onFinalize(): Unit = ()

}

class N5BucketProvider(layer: N5Layer) extends BucketProvider with LazyLogging with RateLimitedErrorLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[N5CubeHandle] = {
    val n5MagOpt: Option[MagLocator] =
      layer.mags.find(_.mag == readInstruction.bucket.mag)

    n5MagOpt match {
      case None => Empty
      case Some(n5Mag) =>
        val magPathOpt: Option[Path] = {
          n5Mag.remoteSource match {
            case Some(remoteSource) => remotePathFrom(remoteSource)
            case None               => localPathFrom(readInstruction, n5Mag.pathWithFallback)
          }
        }
        magPathOpt match {
          case None => Empty
          case Some(magPath) =>
            tryo(onError = e => logError(e))(N5Array.open(magPath, n5Mag.axisOrder)).map(new N5CubeHandle(_))
        }
    }

  }
}
