package com.scalableminds.webknossos.datastore.dataformats.wkw

import java.io.DataOutputStream

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.util.io.{NamedFunctionStream, NamedStream}
import com.scalableminds.webknossos.wrap.{BlockType, WKWFile, WKWHeader}

import scala.collection.mutable
import scala.concurrent.Future

class WKWBucketStreamSink(val layer: DataLayer) extends WKWDataFormatHelper {

  def apply(bucketStream: Iterator[(BucketPosition, Array[Byte])]): Iterator[NamedStream] = {
    val (voxelType, numChannels) = WKWDataFormat.elementClassToVoxelType(layer.elementClass)
    val header = WKWHeader(1, DataLayer.bucketLength, BlockType.LZ4, voxelType, numChannels)
    val mags = new mutable.HashSet[Vec3Int]()
    bucketStream.map {
      case (bucket, data) =>
        val filePath = wkwFilePath(bucket.toCube(bucket.bucketLength)).toString
        mags += bucket.mag
        NamedFunctionStream(
          filePath,
          os => Future.successful(WKWFile.write(os, header, Array(data).toIterator))
        )
    } ++ mags.toSeq.map { mag =>
      NamedFunctionStream(wkwHeaderFilePath(mag).toString,
                          os => Future.successful(header.writeTo(new DataOutputStream(os), isHeaderFile = true)))
    }
  }
}
