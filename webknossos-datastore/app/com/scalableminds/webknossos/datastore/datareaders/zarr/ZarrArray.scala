package com.scalableminds.webknossos.datastore.datareaders.zarr

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Fox, JsonHelper, OxImplicits}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, DatasetArray, DatasetHeader}
import ucar.ma2.{Array => MultiArray}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo

import scala.concurrent.ExecutionContext

object ZarrArray extends LazyLogging with OxImplicits {
  def open(path: VaultPath,
           dataSourceId: DataSourceId,
           layerName: String,
           axisOrderOpt: Option[AxisOrder],
           channelIndex: Option[Int],
           additionalAxes: Option[Seq[AdditionalAxis]],
           sharedChunkContentsCache: AlfuCache[String, MultiArray])(implicit ec: ExecutionContext,
                                                                    tc: TokenContext): Fox[ZarrArray] =
    for {
      headerBytes <- (path / ZarrHeader.FILENAME_DOT_ZARRAY)
        .readBytes() ?~> s"Could not read header at ${ZarrHeader.FILENAME_DOT_ZARRAY}"
      header <- JsonHelper.parseAndValidateJson[ZarrHeader](headerBytes).toFox ?~> "Could not parse array header"
      _ <- DatasetArray.assertChunkSizeLimit(header.bytesPerChunk)
      array <- tryo(
        new ZarrArray(
          path,
          dataSourceId,
          layerName,
          header,
          axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(header.rank)),
          channelIndex,
          additionalAxes,
          sharedChunkContentsCache
        )).toFox ?~> "Could not open zarr2 array"
    } yield array

}

class ZarrArray(vaultPath: VaultPath,
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
