package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, ChunkReader, DatasetArray, DatasetPath, FileSystemStore, GoogleCloudFileSystemStore, GoogleCloudStoragePath}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsError, JsSuccess, Json}

import java.io.IOException
import java.nio.charset.StandardCharsets
import java.nio.file.Path

object PrecomputedArray extends LazyLogging {
  @throws[IOException]
  def open(magPath: Path, axisOrderOpt: Option[AxisOrder], channelIndex: Option[Int]): PrecomputedArray = {

    //val rootPath = new DatasetPath("")

    // magPath = https://www.googleapis.com/storage/v1/b/neuroglancer-fafb-data/o/fafb_v14%2Ffafb_v14_orig%2F64_64_80
    //val basePath = magPath.toString.split("/").init.reduce((a, b) => s"$a/$b")
    // basePath = https://www.googleapis.com/storage/v1/b/neuroglancer-fafb-data/o/fafb_v14%2Ffafb_v14_orig

    val store = new GoogleCloudFileSystemStore(magPath.getParent, magPath.getFileSystem)
    val headerPath = s"${PrecomputedHeader.METADATA_PATH}"
    // headerPath = info?alt=media
    val headerBytes = store.readBytes(headerPath)
    if (headerBytes.isEmpty)
      throw new IOException(
        "'" + PrecomputedHeader.METADATA_PATH + "' expected but is not readable or missing in store.")
    val headerString = new String(headerBytes.get, StandardCharsets.UTF_8)
    val rootHeader: PrecomputedHeader =
      Json.parse(headerString).validate[PrecomputedHeader] match {
        case JsSuccess(parsedHeader, _) =>
          parsedHeader
        case errors: JsError =>
          throw new Exception("Validating json as precomputed metadata failed: " + JsError.toJson(errors).toString())
      }

    // Key of the scale is encoded in magpath
    val key = magPath.getFileName

    val scaleHeader: PrecomputedScaleHeader = PrecomputedScaleHeader(
      rootHeader.getScale(key.toString).getOrElse(throw new IllegalArgumentException()),
      rootHeader)
    if (scaleHeader.bytesPerChunk > DatasetArray.chunkSizeLimitBytes) {
      throw new IllegalArgumentException(
        f"Chunk size of this Precomputed Array exceeds limit of ${DatasetArray.chunkSizeLimitBytes}, got ${scaleHeader.bytesPerChunk}")
    }
    val datasetPath = new GoogleCloudStoragePath(key.toString)
    new PrecomputedArray(datasetPath,
                         store,
                         scaleHeader,
                         axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(scaleHeader.rank)),
                         channelIndex)
  }
}

class PrecomputedArray(relativePath: DatasetPath,
                       store: FileSystemStore,
                       header: PrecomputedScaleHeader,
                       axisOrder: AxisOrder,
                       channelIndex: Option[Int])
    extends DatasetArray(relativePath, store, header, axisOrder, channelIndex)
    with LazyLogging {

  override protected val chunkReader: ChunkReader =
    PrecomputedChunkReader.create(store, header)

  lazy val voxelOffset = header.precomputedScale.voxel_offset.getOrElse(Array(0,0,0))

  override protected def getChunkFilename(chunkIndex: Array[Int]): String = {
    val coordinates: Array[String] = chunkIndex.zipWithIndex.map(indices => {
        val (cIndex, i) = indices
        val beginOffset = voxelOffset(i) + cIndex * header.precomputedScale.chunk_sizes.head(i)
        val endOffset = voxelOffset(i) + ((cIndex + 1) * header.precomputedScale.chunk_sizes.head(i)).min(header.precomputedScale.size(i))
        s"$beginOffset-$endOffset"
    })
    //logger.info(s"${header.precomputedScale.key}: Getting chunk ${chunkIndex(0)},${chunkIndex(1)},${chunkIndex(2)}, resulting in ${coordinates.mkString(header.dimension_separator.toString)}")
    coordinates.mkString(header.dimension_separator.toString)
  }

}
