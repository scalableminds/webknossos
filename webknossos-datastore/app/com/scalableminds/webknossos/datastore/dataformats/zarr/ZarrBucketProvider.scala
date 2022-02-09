package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.bc.zarr.ZarrArray
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCube}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty}
import net.liftweb.util.Helpers.tryo

class ZarrCube(zarrArray: ZarrArray) extends DataCube {

  def cutOutBucket(bucket: BucketPosition): Box[Array[Byte]] = {
    val offset = Array(0, 0, bucket.globalX, bucket.globalY, bucket.globalZ)
    val shape = Array(1, 1, bucket.bucketLength, bucket.bucketLength, bucket.bucketLength)
    tryo(zarrArray.read(offset, shape).asInstanceOf[Array[Byte]])
  }

  override protected def onFinalize(): Unit = ()
}

class ZarrBucketProvider(layer: ZarrLayer) extends BucketProvider with LazyLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[ZarrCube] = {
    val zarrFilePath = readInstruction.baseDir
      .resolve(readInstruction.dataSource.id.team)
      .resolve(readInstruction.dataSource.id.name)
      .resolve(readInstruction.dataLayer.name)
    logger.info(s"zarrFilePath: $zarrFilePath")

    if (zarrFilePath.toFile.exists()) {
      tryo(ZarrArray.open(zarrFilePath)).map(new ZarrCube(_))
    } else Empty
  }

}
