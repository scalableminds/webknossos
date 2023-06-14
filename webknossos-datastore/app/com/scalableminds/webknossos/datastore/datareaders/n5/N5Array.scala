package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, ChunkReader, DatasetArray, DatasetHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsError, JsSuccess, Json}

import java.io.IOException
import java.nio.charset.StandardCharsets

object N5Array extends LazyLogging {
  @throws[IOException]
  def open(path: VaultPath, axisOrderOpt: Option[AxisOrder], channelIndex: Option[Int]): N5Array = {
    val headerBytes = (path / N5Header.FILENAME_ATTRIBUTES_JSON).readBytes()
    if (headerBytes.isEmpty)
      throw new IOException(
        "'" + N5Header.FILENAME_ATTRIBUTES_JSON + "' expected but is not readable or missing in store.")
    val headerString = new String(headerBytes.get, StandardCharsets.UTF_8)
    val header: N5Header =
      Json.parse(headerString).validate[N5Header] match {
        case JsSuccess(parsedHeader, _) =>
          parsedHeader
        case errors: JsError =>
          throw new Exception("Validating json as N5 header failed: " + JsError.toJson(errors).toString())
      }
    if (header.bytesPerChunk > DatasetArray.chunkSizeLimitBytes) {
      throw new IllegalArgumentException(
        f"Chunk size of this N5 Array exceeds limit of ${DatasetArray.chunkSizeLimitBytes}, got ${header.bytesPerChunk}")
    }
    new N5Array(path, header, axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(header.rank)), channelIndex)
  }
}

class N5Array(vaultPath: VaultPath, header: DatasetHeader, axisOrder: AxisOrder, channelIndex: Option[Int])
    extends DatasetArray(vaultPath, header, axisOrder, channelIndex)
    with LazyLogging {

  override protected lazy val chunkReader: ChunkReader =
    new N5ChunkReader(header)
}
