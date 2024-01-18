package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.{NamedFunctionStream, NamedStream}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{
  ChunkType,
  VoxelType,
  WKWDataFormat,
  WKWDataFormatHelper,
  WKWFile,
  WKWHeader
}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.util.tools.ByteUtils

import java.io.DataOutputStream
import scala.concurrent.{ExecutionContext, Future}

class WKWBucketStreamSink(val layer: DataLayer) extends WKWDataFormatHelper with ByteUtils {

  def apply(bucketStream: Iterator[(BucketPosition, Array[Byte])], mags: Seq[Vec3Int])(
      implicit ec: ExecutionContext): Iterator[NamedStream] = {
    val (voxelType, numChannels) = VoxelType.fromElementClass(layer.elementClass)
    val header = WKWHeader(1, DataLayer.bucketLength, ChunkType.LZ4, voxelType, numChannels)
    bucketStream.flatMap {
      case (bucket, data) if !isAllZero(data) =>
        val filePath = wkwFilePath(bucket.toCube(bucket.bucketLength)).toString
        Some(
          NamedFunctionStream(
            filePath,
            os => Future.successful(WKWFile.write(os, header, Array(data).iterator))
          ))
      case _ => None
    } ++ mags.map { mag =>
      NamedFunctionStream(f"${mag.toMagLiteral(allowScalar = true)}/$headerFileName",
                          os => Future.successful(header.writeTo(new DataOutputStream(os), isHeaderFile = true)))
    }
  }
}
