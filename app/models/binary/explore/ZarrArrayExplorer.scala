package models.binary.explore

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.zarr.{
  FileSystemCredentials,
  ZarrDataLayer,
  ZarrLayer,
  ZarrSegmentationLayer
}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.jzarr.ZarrHeader
import com.scalableminds.webknossos.datastore.models.datasource.Category

import scala.concurrent.ExecutionContext.Implicits.global
import java.nio.file.Path

class ZarrArrayExplorer extends RemoteLayerExplorer {

  override def name: String = "Zarr Array"

  override def explore(remotePath: Path,
                       credentials: Option[FileSystemCredentials]): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      zarrayPath <- Fox.successful(remotePath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY))
      name <- guessNameFromPath(remotePath)
      zarrHeader <- parseJsonFromPath[ZarrHeader](zarrayPath) ?~> s"failed to read zarr header at $zarrayPath"
      elementClass <- zarrHeader.elementClass ?~> "failed to read element class from zarr header"
      guessedAxisOrder = AxisOrder.asZyxFromRank(zarrHeader.rank)
      boundingBox <- zarrHeader.boundingBox(guessedAxisOrder) ?~> "failed to read bounding box from zarr header. Make sure data is in (T/C)ZYX format"
      zarrMag = MagLocator(Vec3Int.ones, Some(remotePath.toString), credentials, Some(guessedAxisOrder))
      layer: ZarrLayer = if (looksLikeSegmentationLayer(name, elementClass)) {
        ZarrSegmentationLayer(name, boundingBox, elementClass, List(zarrMag), largestSegmentId = None)
      } else ZarrDataLayer(name, Category.color, boundingBox, elementClass, List(zarrMag))
    } yield List((layer, Vec3Double(1.0, 1.0, 1.0)))

}
