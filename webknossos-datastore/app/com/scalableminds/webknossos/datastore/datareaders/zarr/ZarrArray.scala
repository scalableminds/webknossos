package com.scalableminds.webknossos.datastore.datareaders.zarr

import java.io.IOException
import java.nio.charset.StandardCharsets
import java.nio.file.Path
import com.scalableminds.webknossos.datastore.datareaders.{
  AxisOrder,
  ChunkReader,
  DatasetArray,
  DatasetHeader,
  FileSystemStore,
  DatasetPath
}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsError, JsSuccess, Json}

object ZarrArray extends LazyLogging {
  @throws[IOException]
  def open(path: Path, axisOrderOpt: Option[AxisOrder], channelIndex: Option[Int]): ZarrArray = {
    val store = new FileSystemStore(path)
    val rootPath = new DatasetPath("")
    val headerPath = rootPath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)
    val headerBytes = store.readBytes(headerPath.storeKey)
    if (headerBytes.isEmpty)
      throw new IOException(
        "'" + ZarrHeader.FILENAME_DOT_ZARRAY + "' expected but is not readable or missing in store.")
    val headerString = new String(headerBytes.get, StandardCharsets.UTF_8)
    val header: ZarrHeader =
      Json.parse(headerString).validate[ZarrHeader] match {
        case JsSuccess(parsedHeader, _) =>
          parsedHeader
        case errors: JsError =>
          throw new Exception("Validating json as zarr header failed: " + JsError.toJson(errors).toString())
      }
    if (header.bytesPerChunk > DatasetArray.chunkSizeLimitBytes) {
      throw new IllegalArgumentException(
        f"Chunk size of this Zarr Array exceeds limit of ${DatasetArray.chunkSizeLimitBytes}, got ${header.bytesPerChunk}")
    }
    new ZarrArray(rootPath, store, header, axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(header.rank)), channelIndex)
  }

}

class ZarrArray(relativePath: DatasetPath,
                store: FileSystemStore,
                header: DatasetHeader,
                axisOrder: AxisOrder,
                channelIndex: Option[Int])
    extends DatasetArray(relativePath, store, header, axisOrder)
    with LazyLogging {

  override protected val chunkReader: ChunkReader =
    ChunkReader.create(store, header)
}
