package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.{NamedFunctionStream, NamedStream}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{ChunkType, WKWDataFormatHelper, WKWFile, WKWHeader}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.util.tools.{ByteUtils, Fox, FoxImplicits}

import java.io.DataOutputStream
import scala.concurrent.ExecutionContext

class WKWBucketStreamSink(val layer: DataLayer, tracingHasFallbackLayer: Boolean)
    extends WKWDataFormatHelper
    with ReversionHelper
    with FoxImplicits
    with ByteUtils {

  def apply(bucketStream: Iterator[(BucketPosition, Array[Byte])], mags: Seq[Vec3Int])(
      implicit ec: ExecutionContext): Iterator[NamedStream] = {
    val (dataType, numChannels) = ElementClass.toArrayDataTypeAndChannel(layer.elementClass)
    val header = WKWHeader(1, DataLayer.bucketLength, ChunkType.LZ4, dataType, numChannels)
    bucketStream.flatMap {
      case (bucket, data) =>
        val skipBucket = if (tracingHasFallbackLayer) isRevertedElement(data) else isAllZero(data)
        if (skipBucket) {
          // If the tracing has no fallback segmentation, all-zero buckets can be omitted entirely
          None
        } else {
          val filePath = wkwFilePath(bucket)
          Some(
            NamedFunctionStream(
              filePath,
              os => WKWFile.write(os, header, Array(data).iterator).toFox
            ))
        }
      case _ => None
    } ++ mags.map { mag =>
      NamedFunctionStream(f"${mag.toMagLiteral(allowScalar = true)}/$FILENAME_HEADER_WKW",
                          os => Fox.successful(header.writeTo(new DataOutputStream(os), isHeaderFile = true)))
    }
  }

}
