package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.{NamedFunctionStream, NamedStream}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataFormat, WKWDataFormatHelper}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.util.tools.ByteUtils
import com.scalableminds.webknossos.wrap.{BlockType, WKWFile, WKWHeader}

import java.io.DataOutputStream
import scala.concurrent.{ExecutionContext, Future}

class WKWBucketStreamSink(val layer: DataLayer, tracingHasFallbackLayer: Boolean)
    extends WKWDataFormatHelper
    with VolumeBucketReversionHelper
    with ByteUtils {

  def apply(bucketStream: Iterator[(BucketPosition, Array[Byte])], mags: Seq[Vec3Int])(
      implicit ec: ExecutionContext): Iterator[NamedStream] = {
    val (voxelType, numChannels) = WKWDataFormat.elementClassToVoxelType(layer.elementClass)
    val header = WKWHeader(1, DataLayer.bucketLength, BlockType.LZ4, voxelType, numChannels)
    bucketStream.flatMap {
      case (bucket, data) =>
        val skipBucket = if (tracingHasFallbackLayer) isRevertedBucket(data) else isAllZero(data)
        if (skipBucket) {
          // If the tracing has no fallback segmentation, all-zero buckets can be omitted entirely
          None
        } else {
          val filePath = wkwFilePath(bucket.toCube(bucket.bucketLength)).toString
          Some(
            NamedFunctionStream(
              filePath,
              os => Future.successful(WKWFile.write(os, header, Array(data).iterator))
            ))
        }
      case _ => None
    } ++ mags.map { mag =>
      NamedFunctionStream(wkwHeaderFilePath(mag).toString,
                          os => Future.successful(header.writeTo(new DataOutputStream(os), isHeaderFile = true)))
    }
  }

}
