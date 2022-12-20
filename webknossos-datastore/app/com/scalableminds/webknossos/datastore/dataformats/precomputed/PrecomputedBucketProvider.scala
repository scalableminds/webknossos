package com.scalableminds.webknossos.datastore.dataformats.precomputed

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.requestlogging.RateLimitedErrorLogging
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle, MagLocator}
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedArray
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo

import java.nio.file.Path
import scala.concurrent.ExecutionContext

class PrecomputedCubeHandle(precomputedArray: PrecomputedArray)
    extends DataCubeHandle
    with LazyLogging
    with RateLimitedErrorLogging {

  def cutOutBucket(bucket: BucketPosition)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val shape = Vec3Int.full(bucket.bucketLength)
    val offset = Vec3Int(bucket.voxelXInMag, bucket.voxelYInMag, bucket.voxelZInMag)
    precomputedArray.readBytesXYZ(shape, offset).recover {
      case t: Throwable => logError(t); Failure(t.getMessage, Full(t), Empty)
    }
  }

  override protected def onFinalize(): Unit = ()

}

class PrecomputedBucketProvider(layer: PrecomputedLayer)
    extends BucketProvider
    with LazyLogging
    with RateLimitedErrorLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[PrecomputedCubeHandle] = {
    val precomputedMagOpt: Option[MagLocator] =
      layer.mags.find(_.mag == readInstruction.bucket.mag)

    precomputedMagOpt match {
      case None => Empty
      case Some(precomputedMag) =>
        val magPathOpt: Option[Path] = {
          precomputedMag.remoteSource match {
            case Some(remoteSource) => remotePathFrom(remoteSource)
            case None               => localPathFrom(readInstruction, precomputedMag.pathWithFallback)
          }
        }
        magPathOpt match {
          case None => Empty
          case Some(magPath) =>
            tryo(onError = e => logError(e))(
              PrecomputedArray.open(magPath, precomputedMag.axisOrder, precomputedMag.channelIndex))
              .map(new PrecomputedCubeHandle(_))
        }
    }

  }
}
