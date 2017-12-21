package com.scalableminds.braingames.binary.dataformats.wkw

import java.io.DataOutputStream

import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.braingames.binary.models.datasource.DataLayer
import com.scalableminds.util.io.{NamedFunctionStream, NamedStream}
import com.scalableminds.webknossos.wrap.{BlockType, WKWFile, WKWHeader}

import scala.concurrent.Future

class WKWBucketStreamSink(val layer: DataLayer) extends WKWDataFormatHelper {

  def apply(bucketStream: Iterator[(BucketPosition, Array[Byte])]): Iterator[NamedStream] = {
    val (voxelType, numChannels) = WKWDataFormat.elementClassToVoxelType(layer.elementClass)
    val header = WKWHeader(1, DataLayer.bucketLength, BlockType.LZ4, voxelType, numChannels)
    bucketStream.map {
      case (bucket, data) =>
        val filePath = wkwFilePath(bucket.toCube(bucket.bucketLength)).toString
        NamedFunctionStream(filePath, os => {
          Future.successful(WKWFile.write(os, header, Array(data).toIterator))
        })
    } ++ Seq(NamedFunctionStream(wkwHeaderFilePath(1).toString, os =>
      Future.successful(header.writeTo(new DataOutputStream(os), true))))
  }
}
