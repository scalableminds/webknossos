package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, ChunkReader, DatasetArray, DatasetHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Fox.{box2Fox, option2Fox}

import scala.concurrent.ExecutionContext

object N5Array extends LazyLogging {

  def open(path: VaultPath, axisOrderOpt: Option[AxisOrder], channelIndex: Option[Int])(
      implicit ec: ExecutionContext): Fox[N5Array] =
    for {
      headerBytes <- (path / N5Header.FILENAME_ATTRIBUTES_JSON)
        .readBytes() ?~> s"Could not read header ${N5Header.FILENAME_ATTRIBUTES_JSON}"
      header <- JsonHelper.parseAndValidateJson[N5Header](headerBytes) ?~> "Could not parse array header"
      _ <- DatasetArray.assertChunkSizeLimit(header.bytesPerChunk)
    } yield new N5Array(path, header, axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(header.rank)), channelIndex)

}

class N5Array(vaultPath: VaultPath, header: DatasetHeader, axisOrder: AxisOrder, channelIndex: Option[Int])
    extends DatasetArray(vaultPath, header, axisOrder, channelIndex)
    with LazyLogging {

  override protected lazy val chunkReader: ChunkReader =
    new N5ChunkReader(header)
}
