package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Fox, JsonHelper, FoxImplicits}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, ChunkReader, DatasetArray, DatasetHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import ucar.ma2.{Array => MultiArray}

import scala.concurrent.ExecutionContext

object N5Array extends LazyLogging with FoxImplicits {

  def open(path: VaultPath,
           dataSourceId: DataSourceId,
           layerName: String,
           axisOrderOpt: Option[AxisOrder],
           channelIndex: Option[Int],
           additionalAxes: Option[Seq[AdditionalAxis]],
           sharedChunkContentsCache: AlfuCache[String, MultiArray])(implicit ec: ExecutionContext,
                                                                    tc: TokenContext): Fox[N5Array] =
    for {
      headerBytes <- (path / N5Header.FILENAME_ATTRIBUTES_JSON)
        .readBytes() ?~> s"Could not read header at ${N5Header.FILENAME_ATTRIBUTES_JSON}"
      header <- JsonHelper.parseAndValidateJson[N5Header](headerBytes).toFox ?~> "Could not parse array header"
      _ <- DatasetArray.assertChunkSizeLimit(header.bytesPerChunk)
      array <- tryo(
        new N5Array(path,
                    dataSourceId,
                    layerName,
                    header,
                    axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(header.rank)),
                    channelIndex,
                    additionalAxes,
                    sharedChunkContentsCache)).toFox ?~> "Could not open n5 array"
    } yield array
}

class N5Array(vaultPath: VaultPath,
              dataSourceId: DataSourceId,
              layerName: String,
              header: DatasetHeader,
              axisOrder: AxisOrder,
              channelIndex: Option[Int],
              additionalAxes: Option[Seq[AdditionalAxis]],
              sharedChunkContentsCache: AlfuCache[String, MultiArray])
    extends DatasetArray(vaultPath,
                         dataSourceId,
                         layerName,
                         header,
                         axisOrder,
                         channelIndex,
                         additionalAxes,
                         sharedChunkContentsCache)
    with LazyLogging {

  override protected lazy val chunkReader: ChunkReader =
    new N5ChunkReader(header)
}
