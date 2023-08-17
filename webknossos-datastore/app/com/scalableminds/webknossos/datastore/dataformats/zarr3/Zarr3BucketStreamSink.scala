package com.scalableminds.webknossos.datastore.dataformats.zarr3

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.{NamedFunctionStream, NamedStream}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataFormat, WKWDataFormatHelper}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.wrap.{BlockType, WKWFile, WKWHeader}

import java.io.DataOutputStream
import scala.concurrent.Future

class Zarr3BucketStreamSink(val layer: DataLayer) {

  def apply(bucketStream: Iterator[(BucketPosition, Array[Byte])], mags: Seq[Vec3Int]): Iterator[NamedStream] = {
    val (voxelType, numChannels) = WKWDataFormat.elementClassToVoxelType(layer.elementClass)
    val header = WKWHeader(1, DataLayer.bucketLength, BlockType.LZ4, voxelType, numChannels)
    bucketStream.map {
      case (bucket, data) =>
        val filePath = zarrFilePath(bucket.toCube(bucket.bucketLength)).toString
        NamedFunctionStream(
          filePath,
          os => Future.successful(WKWFile.write(os, header, Array(data).toIterator))
        )
    } ++ mags.map { mag =>
      NamedFunctionStream(zarrHeaderFilePath(mag).toString,
                          os => Future.successful(header.writeTo(new DataOutputStream(os), isHeaderFile = true)))
    }
  }

}
