package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{Zarr3DataLayer, Zarr3Layer, Zarr3SegmentationLayer}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.Category

import scala.concurrent.ExecutionContext

class Zarr3ArrayExplorer(implicit val ec: ExecutionContext) extends RemoteLayerExplorer {

  override def name: String = "Zarr v3 Array"

  override def explore(remotePath: VaultPath, credentialId: Option[String])(
      implicit tc: TokenContext): Fox[List[(Zarr3Layer, VoxelSize)]] =
    for {
      zarrayPath <- Fox.successful(remotePath / Zarr3ArrayHeader.FILENAME_ZARR_JSON)
      name = guessNameFromPath(remotePath)
      zarrHeader <- zarrayPath.parseAsJson[Zarr3ArrayHeader] ?~> s"failed to read zarr v3 header at $zarrayPath"
      _ <- zarrHeader.assertValid.toFox
      elementClass <- zarrHeader.elementClass ?~> "failed to read element class from zarr header"
      guessedAxisOrder = AxisOrder.asCxyzFromRank(zarrHeader.rank)
      boundingBox <- zarrHeader.boundingBox(guessedAxisOrder) ?~> "failed to read bounding box from zarr header. Make sure data is in (T/C)ZYX format"
      magLocator = MagLocator(Vec3Int.ones,
                              Some(remotePath.toUri.toString),
                              None,
                              Some(guessedAxisOrder),
                              None,
                              credentialId)
      layer: Zarr3Layer = if (looksLikeSegmentationLayer(name, elementClass)) {
        Zarr3SegmentationLayer(name, boundingBox, elementClass, List(magLocator), largestSegmentId = None)
      } else Zarr3DataLayer(name, Category.color, boundingBox, elementClass, List(magLocator))
    } yield List((layer, VoxelSize.fromFactorWithDefaultUnit(Vec3Double.ones)))

}
