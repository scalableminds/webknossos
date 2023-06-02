package models.binary.explore

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.zarr.v3.{
  ZarrV3DataLayer,
  ZarrV3Layer,
  ZarrV3SegmentationLayer
}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr3.ZarrV3ArrayHeader
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.Category

import scala.concurrent.ExecutionContext.Implicits.global

class ZarrV3ArrayExplorer extends RemoteLayerExplorer {

  override def name: String = "Zarr V3 Array"

  override def explore(remotePath: VaultPath, credentialId: Option[String]): Fox[List[(ZarrV3Layer, Vec3Double)]] =
    for {
      zarrayPath <- Fox.successful(remotePath / ZarrV3ArrayHeader.ZARR_JSON)
      name = guessNameFromPath(remotePath)
      zarrHeader <- parseJsonFromPath[ZarrV3ArrayHeader](zarrayPath) ?~> s"failed to read zarr v3 header at $zarrayPath"
      _ <- zarrHeader.assertValid
      elementClass <- zarrHeader.elementClass ?~> "failed to read element class from zarr header"
      guessedAxisOrder = AxisOrder.asCxyzFromRank(zarrHeader.rank)
      boundingBox <- zarrHeader.boundingBox(guessedAxisOrder) ?~> "failed to read bounding box from zarr header. Make sure data is in (T/C)ZYX format"
      magLocator = MagLocator(Vec3Int.ones,
                              Some(remotePath.toUri.toString),
                              None,
                              Some(guessedAxisOrder),
                              None,
                              credentialId)
      layer: ZarrV3Layer = if (looksLikeSegmentationLayer(name, elementClass)) {
        ZarrV3SegmentationLayer(name, boundingBox, elementClass, List(magLocator), largestSegmentId = None)
      } else ZarrV3DataLayer(name, Category.color, boundingBox, elementClass, List(magLocator))
    } yield List((layer, Vec3Double(1.0, 1.0, 1.0)))

}
