package com.scalableminds.webknossos.datastore.dataformats.zarr3

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.{NamedFunctionStream, NamedStream}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataFormat, WKWDataFormatHelper}
import com.scalableminds.webknossos.datastore.geometry.AdditionalAxisProto
import com.scalableminds.webknossos.datastore.models.{BucketPosition}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import scala.concurrent.Future

class Zarr3BucketStreamSink(val layer: DataLayer) {

  private def zarrChunkFilePath(bucketPosition: BucketPosition): String =
    // TODO: additional coordinates
    s"${bucketPosition.mag.toMagLiteral()}/c/${bucketPosition.bucketZ}/${bucketPosition.bucketY}/${bucketPosition.bucketX}"

  private def zarrHeaderFilePath(mag: Vec3Int): String = ???

  def apply(bucketStream: Iterator[(BucketPosition, Array[Byte])],
            mags: Seq[Vec3Int],
            additionalAxes: Seq[AdditionalAxisProto]): Iterator[NamedStream] = {
    val (voxelType, numChannels) = WKWDataFormat.elementClassToVoxelType(layer.elementClass)
    //val header = WKWHeader(1, DataLayer.bucketLength, BlockType.LZ4, voxelType, numChannels)
    // TODO register shape for metadata
    bucketStream.map {
      case (bucket, data) =>
        val filePath = zarrChunkFilePath(bucket)
        NamedFunctionStream(
          filePath,
          os => Future.successful(os.write(data)) // TODO compress?
        )
    } /* ++ mags.map { mag =>
      NamedFunctionStream(zarrHeaderFilePath(mag).toString,
                          os => Future.successful(header.writeTo(new DataOutputStream(os), isHeaderFile = true)))
    }*/
  }

}
