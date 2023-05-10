package com.scalableminds.webknossos.datastore.dataformats.precomputed

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, TextUtils}
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle, MagLocator}
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedArray
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Empty
import net.liftweb.util.Helpers.tryo

import scala.concurrent.ExecutionContext

class PrecomputedCubeHandle(precomputedArray: PrecomputedArray) extends DataCubeHandle with LazyLogging {

  def cutOutBucket(bucket: BucketPosition)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val shape = Vec3Int.full(bucket.bucketLength)
    val offset = Vec3Int(bucket.topLeft.voxelXInMag, bucket.topLeft.voxelYInMag, bucket.topLeft.voxelZInMag)
    precomputedArray.readBytesXYZ(shape, offset)
  }

  override protected def onFinalize(): Unit = ()

}

class PrecomputedBucketProvider(layer: PrecomputedLayer, val dataVaultServiceOpt: Option[DataVaultService])
    extends BucketProvider
    with LazyLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[PrecomputedCubeHandle] = {
    val precomputedMagOpt: Option[MagLocator] =
      layer.mags.find(_.mag == readInstruction.bucket.mag)

    precomputedMagOpt match {
      case None => Fox.empty
      case Some(precomputedMag) =>
        dataVaultServiceOpt match {
          case Some(dataVaultService: DataVaultService) =>
            for {
              magPath: VaultPath <- if (precomputedMag.isRemote) {
                dataVaultService.vaultPathFor(precomputedMag)
              } else localPathFrom(readInstruction, precomputedMag.pathWithFallback)
              cubeHandle <- tryo(onError = (e: Throwable) => logger.error(TextUtils.stackTraceAsString(e)))(
                PrecomputedArray.open(magPath, precomputedMag.axisOrder, precomputedMag.channelIndex))
                .map(new PrecomputedCubeHandle(_))
            } yield cubeHandle
          case None => Empty
        }

    }
  }

}
