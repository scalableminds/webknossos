package com.scalableminds.webknossos.datastore.datareaders.wkw

import com.google.common.io.LittleEndianDataInputStream
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataFormat, WKWHeader}
import com.scalableminds.webknossos.datastore.datareaders.zarr.{ZarrArray, ZarrHeader}
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, DatasetArray, DatasetHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataSourceId}
import com.typesafe.scalalogging.LazyLogging
import ucar.ma2.{Array => MultiArray}

import java.io.ByteArrayInputStream
import scala.concurrent.ExecutionContext

object WKWArray {
  def open(path: VaultPath,
           dataSourceId: DataSourceId,
           layerName: String,
           sharedChunkContentsCache: AlfuCache[String, MultiArray])(implicit ec: ExecutionContext): Fox[WKWArray] =
    for {
      headerBytes <- (path / WKWDataFormat.FILENAME_HEADER_WKW)
        .readBytes() ?~> s"Could not read header at ${ZarrHeader.FILENAME_DOT_ZARRAY}"
      dataInputStream = new LittleEndianDataInputStream(new ByteArrayInputStream(headerBytes))
      header <- WKWHeader(dataInputStream, readJumpTable = false).toFox
    } yield
      new WKWArray(path,
                   dataSourceId,
                   layerName,
                   header,
                   AxisOrder.asZyxFromRank(3),
                   None,
                   None,
                   sharedChunkContentsCache)
}

class WKWArray(vaultPath: VaultPath,
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
