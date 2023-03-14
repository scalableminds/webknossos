package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, ChunkReader, DatasetArray, DatasetPath}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsError, JsSuccess, Json}

import java.io.IOException
import java.nio.charset.StandardCharsets

object PrecomputedArray extends LazyLogging {
  @throws[IOException]
  def open(magPath: VaultPath, axisOrderOpt: Option[AxisOrder], channelIndex: Option[Int]): PrecomputedArray = {

    val basePath = magPath.getParent.asInstanceOf[VaultPath]
    val headerPath = s"${PrecomputedHeader.FILENAME_INFO}"
    val headerBytes = basePath.readBytes(headerPath)
    if (headerBytes.isEmpty)
      throw new IOException(
        "'" + PrecomputedHeader.FILENAME_INFO + "' expected but is not readable or missing in store.")
    val headerString = new String(headerBytes.get, StandardCharsets.UTF_8)
    val rootHeader: PrecomputedHeader =
      Json.parse(headerString).validate[PrecomputedHeader] match {
        case JsSuccess(parsedHeader, _) =>
          parsedHeader
        case errors: JsError =>
          throw new Exception("Validating json as precomputed metadata failed: " + JsError.toJson(errors).toString())
      }

    val key = magPath.getFileName

    val scaleHeader: PrecomputedScaleHeader = PrecomputedScaleHeader(
      rootHeader
        .getScale(key.toString)
        .getOrElse(throw new IllegalArgumentException(s"Did not find a scale for key $key")),
      rootHeader)
    if (scaleHeader.bytesPerChunk > DatasetArray.chunkSizeLimitBytes) {
      throw new IllegalArgumentException(
        f"Chunk size of this Precomputed Array exceeds limit of ${DatasetArray.chunkSizeLimitBytes}, got ${scaleHeader.bytesPerChunk}")
    }
    val datasetPath = new DatasetPath(key.toString)
    new PrecomputedArray(datasetPath,
                         basePath,
                         scaleHeader,
                         axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(scaleHeader.rank)),
                         channelIndex)
  }
}

class PrecomputedArray(relativePath: DatasetPath,
                       vaultPath: VaultPath,
                       header: PrecomputedScaleHeader,
                       axisOrder: AxisOrder,
                       channelIndex: Option[Int])
    extends DatasetArray(relativePath, vaultPath, header, axisOrder, channelIndex)
    with LazyLogging {

  override protected val chunkReader: ChunkReader =
    PrecomputedChunkReader.create(vaultPath, header)

  lazy val voxelOffset: Array[Int] = header.precomputedScale.voxel_offset.getOrElse(Array(0, 0, 0))
  override protected def getChunkFilename(chunkIndex: Array[Int]): String = {

    val bbox = header.chunkIndexToNDimensionalBoundingBox(chunkIndex)
    bbox
      .map(dim => {
        s"${dim._1}-${dim._2}"
      })
      .mkString(header.dimension_separator.toString)
  }

}
