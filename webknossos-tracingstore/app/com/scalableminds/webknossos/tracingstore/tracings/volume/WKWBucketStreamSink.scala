package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.{NamedFunctionStream, NamedStream}
import com.scalableminds.util.tools.{AsyncIterator, ByteUtils, Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{ChunkType, WKWDataFormatHelper, WKWFile, WKWHeader}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}

import java.io.DataOutputStream
import scala.concurrent.ExecutionContext

class WKWBucketStreamSink(val layer: DataLayer, tracingHasFallbackLayer: Boolean)
    extends WKWDataFormatHelper
    with ReversionHelper
    with FoxImplicits
    with ByteUtils {

  def apply(bucketStream: AsyncIterator[(BucketPosition, Array[Byte])], mags: Seq[Vec3Int])(
      implicit ec: ExecutionContext): AsyncIterator[NamedStream] = {
    val (dataType, numChannels) = ElementClass.toArrayDataTypeAndChannel(layer.elementClass)
    val header = WKWHeader(1, DataLayer.bucketLength, ChunkType.LZ4, dataType, numChannels)

    new AsyncIterator[NamedStream] {
      private var bucketsExhausted = false
      private var headersEmitted = false

      override def nextBatch(): Fox[List[NamedStream]] =
        if (!bucketsExhausted) {
          bucketStream.nextBatch().flatMap {
            case Nil =>
              bucketsExhausted = true
              nextBatch()
            case batch =>
              val streams: List[NamedStream] = batch.flatMap {
                case (bucket, data) =>
                  val skipBucket = if (tracingHasFallbackLayer) isRevertedElement(data) else isAllZero(data)
                  if (skipBucket) None
                  else
                    Some(
                      NamedFunctionStream(
                        wkwFilePath(bucket),
                        os => WKWFile.write(os, header, Array(data).iterator).toFox
                      ))
              }
              if (streams.nonEmpty) Fox.successful(streams)
              else nextBatch()
          }
        } else if (!headersEmitted) {
          headersEmitted = true
          Fox.successful(mags.map { mag =>
            NamedFunctionStream(
              f"${mag.toMagLiteral(allowScalar = true)}/$FILENAME_HEADER_WKW",
              os => Fox.successful(header.writeTo(new DataOutputStream(os), isHeaderFile = true))
            )
          }.toList)
        } else {
          Fox.successful(Nil)
        }
    }
  }
}
