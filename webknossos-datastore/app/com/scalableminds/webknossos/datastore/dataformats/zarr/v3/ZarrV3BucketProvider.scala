package com.scalableminds.webknossos.datastore.dataformats.zarr.v3

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, TextUtils}
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle, MagLocator}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.ZarrV3Array
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Empty
import net.liftweb.util.Helpers.tryo

import scala.concurrent.ExecutionContext

class ZarrCubeHandle(zarrArray: ZarrV3Array) extends DataCubeHandle with LazyLogging {

  def cutOutBucket(bucket: BucketPosition)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val shape = Vec3Int.full(bucket.bucketLength)
    val offset = Vec3Int(bucket.topLeft.voxelXInMag, bucket.topLeft.voxelYInMag, bucket.topLeft.voxelZInMag)
    zarrArray.readBytesXYZ(shape, offset)
  }

  override protected def onFinalize(): Unit = ()

}

class ZarrV3BucketProvider(layer: ZarrV3Layer, val dataVaultServiceOpt: Option[DataVaultService])
    extends BucketProvider
    with LazyLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[ZarrCubeHandle] = {
    val zarrMagOpt: Option[MagLocator] =
      layer.mags.find(_.mag == readInstruction.bucket.mag)

    zarrMagOpt match {
      case None => Fox.empty
      case Some(zarrMag) =>
        dataVaultServiceOpt match {
          case Some(dataVaultService: DataVaultService) =>
            for {
              magPath: VaultPath <- if (zarrMag.isRemote) {
                dataVaultService.vaultPathFor(zarrMag)
              } else localPathFrom(readInstruction, zarrMag.pathWithFallback)
              cubeHandle <- tryo(onError = (e: Throwable) => logger.error(TextUtils.stackTraceAsString(e)))(
                ZarrV3Array.open(magPath, zarrMag.axisOrder, zarrMag.channelIndex)).map(new ZarrCubeHandle(_))
            } yield cubeHandle
          case None => Empty
        }
    }
  }
}
