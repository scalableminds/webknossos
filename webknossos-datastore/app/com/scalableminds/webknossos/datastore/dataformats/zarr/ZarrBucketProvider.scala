package com.scalableminds.webknossos.datastore.dataformats.zarr

import java.nio.file.FileSystem
import java.nio.{ByteBuffer, ByteOrder}

import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCube}
import com.scalableminds.webknossos.datastore.jzarr.ZarrArray
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.FileSystemHolder
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Full}

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
    val useLocal = layer.fileSystemSelector.typ == FileSystemType.Local
    FileSystemHolder
      .getOrCreate(layer.fileSystemSelector)
      .map { fs: FileSystem =>
        val layerPath = if (useLocal) {
          readInstruction.baseDir
            .resolve(readInstruction.dataSource.id.team)
            .resolve(readInstruction.dataSource.id.name)
            .resolve(readInstruction.dataLayer.name)
        } else {
          fs.getPath(layer.remotePath.getOrElse(""))
        }

        if (!useLocal || layerPath.toFile.exists()) {
          logger.info(s"opening: $layerPath")
          Full(ZarrArray.open(layerPath)).map(new ZarrCube(_))
        } else Empty
      }
      .getOrElse(Empty)
  }

}
