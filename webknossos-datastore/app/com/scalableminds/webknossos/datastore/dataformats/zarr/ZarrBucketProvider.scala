package com.scalableminds.webknossos.datastore.dataformats.zarr

import java.nio.file.Paths
import java.nio.{ByteBuffer, ByteOrder}

import com.bc.zarr.ZarrArray
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCube}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Full}
import net.liftweb.util.Helpers.tryo

class ZarrCube(zarrArray: ZarrArray) extends DataCube with LazyLogging {

  def cutOutBucket(bucket: BucketPosition): Box[Array[Byte]] = {
    val offset = Array(0, 0, bucket.globalZ, bucket.globalY, bucket.globalX)
    val shape = Array(1, 1, bucket.bucketLength, bucket.bucketLength, bucket.bucketLength)
    Full(toByteArray(zarrArray.read(shape, offset).asInstanceOf[Array[Short]]))
  }

  private def toByteArray(dataShort: Array[Short]): Array[Byte] = {
    val buffer = ByteBuffer.allocate(dataShort.length * 2).order(ByteOrder.LITTLE_ENDIAN)
    buffer.asShortBuffer().put(dataShort)
    buffer.array()
  }

  override protected def onFinalize(): Unit = ()

}

class ZarrBucketProvider(layer: ZarrLayer) extends BucketProvider with LazyLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[ZarrCube] = {
    val useS3 = false

    val layerPath = if (useS3) {
      s"https://.../${readInstruction.dataLayer.name}"
    } else {
      readInstruction.baseDir
        .resolve(readInstruction.dataSource.id.team)
        .resolve(readInstruction.dataSource.id.name)
        .resolve(readInstruction.dataLayer.name)
        .toString
    }
    logger.info(s"zarrFilePath: $layerPath")

    if (useS3 || Paths.get(layerPath).toFile.exists()) {
      tryo(ZarrArray.open(layerPath)).map(new ZarrCube(_))
    } else Empty
  }

}
