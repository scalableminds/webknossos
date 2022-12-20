package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.webknossos.datastore.datareaders.{
  AxisOrder,
  ChunkReader,
  DatasetArray,
  DatasetHeader,
  DatasetPath,
  FileSystemStore
}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsError, JsSuccess, Json}

import java.io.IOException
import java.nio.charset.StandardCharsets
import java.nio.file.Path

object PrecomputedArray extends LazyLogging {
  @throws[IOException]
  def open(path: Path, axisOrderOpt: Option[AxisOrder], channelIndex: Option[Int]): PrecomputedArray = {
    val store = new FileSystemStore(path)
    val rootPath = new DatasetPath("")
    val headerPath = rootPath.resolve(PrecomputedHeader.METADATA_PATH)
    val headerBytes = store.readBytes(headerPath.storeKey)
    if (headerBytes.isEmpty)
      throw new IOException(
        "'" + PrecomputedHeader.METADATA_PATH + "' expected but is not readable or missing in store.")
    val headerString = new String(headerBytes.get, StandardCharsets.UTF_8)
    val header: PrecomputedHeader =
      Json.parse(headerString).validate[PrecomputedHeader] match {
        case JsSuccess(parsedHeader, _) =>
          parsedHeader
        case errors: JsError =>
          throw new Exception("Validating json as precomputed metadata failed: " + JsError.toJson(errors).toString())
      }
    if (header.bytesPerChunk > DatasetArray.chunkSizeLimitBytes) {
      throw new IllegalArgumentException(
        f"Chunk size of this Precomputed Array exceeds limit of ${DatasetArray.chunkSizeLimitBytes}, got ${header.bytesPerChunk}")
    }
    new PrecomputedArray(rootPath,
                         store,
                         header,
                         axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(header.rank)),
                         channelIndex)
  }
}

class PrecomputedArray(relativePath: DatasetPath,
                       store: FileSystemStore,
                       header: DatasetHeader,
                       axisOrder: AxisOrder,
                       channelIndex: Option[Int])
    extends DatasetArray(relativePath, store, header, axisOrder, channelIndex)
    with LazyLogging {

  override protected val chunkReader: ChunkReader =
    PrecomputedChunkReader.create(store, header)
}
