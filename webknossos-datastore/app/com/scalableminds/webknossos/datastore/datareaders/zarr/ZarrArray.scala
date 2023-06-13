package com.scalableminds.webknossos.datastore.datareaders.zarr

import com.scalableminds.util.tools.Fox.{box2Fox, option2Fox}
import com.scalableminds.util.tools.{Fox, JsonHelper}

import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, DatasetArray, DatasetHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging

import scala.concurrent.ExecutionContext

object ZarrArray extends LazyLogging {
  def open(path: VaultPath, axisOrderOpt: Option[AxisOrder], channelIndex: Option[Int])(
      implicit ec: ExecutionContext): Fox[ZarrArray] =
    for {
      headerBytes <- (path / ZarrHeader.FILENAME_DOT_ZARRAY)
        .readBytes() ?~> s"Could not read header ${ZarrHeader.FILENAME_DOT_ZARRAY}"
      header <- JsonHelper.parseAndValidateJson[ZarrHeader](headerBytes) ?~> "Could not parse array header"
      _ <- DatasetArray.assertChunkSizeLimit(header.bytesPerChunk)
    } yield new ZarrArray(path, header, axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(header.rank)), channelIndex)
}

class ZarrArray(vaultPath: VaultPath, header: DatasetHeader, axisOrder: AxisOrder, channelIndex: Option[Int])
    extends DatasetArray(vaultPath, header, axisOrder, channelIndex)
    with LazyLogging
