package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{ZarrDataLayer, ZarrLayer, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr.ZarrHeader
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.Category

import scala.concurrent.ExecutionContext

class ZarrArrayExplorer(mag: Vec3Int = Vec3Int.ones)(implicit val ec: ExecutionContext) extends RemoteLayerExplorer {

  override def name: String = "Zarr Array"

  override def explore(remotePath: VaultPath, credentialId: Option[String]): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      zarrayPath <- Fox.successful(remotePath / ZarrHeader.FILENAME_DOT_ZARRAY)
      name = guessNameFromPath(remotePath)
      zarrHeader <- parseJsonFromPath[ZarrHeader](zarrayPath) ?~> s"failed to read zarr header at $zarrayPath"
      elementClass <- zarrHeader.elementClass ?~> "failed to read element class from zarr header"
      guessedAxisOrder = AxisOrder.asZyxFromRank(zarrHeader.rank)
      boundingBox <- zarrHeader.boundingBox(guessedAxisOrder) ?~> "failed to read bounding box from zarr header. Make sure data is in (T/C)ZYX format"
      magLocator = MagLocator(mag, Some(remotePath.toUri.toString), None, Some(guessedAxisOrder), None, credentialId)
      layer: ZarrLayer = if (looksLikeSegmentationLayer(name, elementClass)) {
        ZarrSegmentationLayer(name, boundingBox, elementClass, List(magLocator), largestSegmentId = None)
      } else
        ZarrDataLayer(name, Category.color, boundingBox, elementClass, List(magLocator), additionalAxes = None)
    } yield List((layer, Vec3Double.ones))

}
