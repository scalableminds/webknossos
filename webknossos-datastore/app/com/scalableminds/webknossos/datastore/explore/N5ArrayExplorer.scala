package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Header
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataFormat,
  StaticColorLayer,
  StaticLayer,
  StaticSegmentationLayer
}

import scala.concurrent.ExecutionContext

class N5ArrayExplorer(implicit val ec: ExecutionContext) extends N5Explorer with FoxImplicits {

  override def name: String = "N5 Array"

  override def explore(remotePath: VaultPath, credentialId: Option[String])(
      implicit tc: TokenContext): Fox[List[(StaticLayer, VoxelSize)]] =
    for {
      headerPath <- Fox.successful(remotePath / N5Header.FILENAME_ATTRIBUTES_JSON)
      name = guessNameFromPath(remotePath)
      n5Header <- headerPath.parseAsJson[N5Header] ?~> s"failed to read n5 header at $headerPath"
      elementClass <- n5Header.elementClass.toFox ?~> "failed to read element class from n5 header"
      guessedAxisOrder = AxisOrder.asZyxFromRank(n5Header.rank)
      boundingBox <- n5Header
        .boundingBox(guessedAxisOrder)
        .toFox ?~> "failed to read bounding box from zarr header. Make sure data is in (T/C)ZYX format"
      magLocator = MagLocator(Vec3Int.ones,
                              Some(remotePath.toUri.toString),
                              None,
                              Some(guessedAxisOrder),
                              None,
                              credentialId)
      layer: StaticLayer = if (looksLikeSegmentationLayer(name, elementClass)) {
        StaticSegmentationLayer(name,
                                DataFormat.n5,
                                boundingBox,
                                elementClass,
                                List(magLocator),
                                largestSegmentId = None)
      } else StaticColorLayer(name, DataFormat.n5, boundingBox, elementClass, List(magLocator))
    } yield List((layer, VoxelSize.fromFactorWithDefaultUnit(Vec3Double.ones)))

}
