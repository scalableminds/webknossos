package models.binary.explore
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.n5.{N5DataLayer, N5Layer, N5SegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr.FileSystemCredentials
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Header
import com.scalableminds.webknossos.datastore.models.datasource.Category

import java.nio.file.Path
import scala.concurrent.ExecutionContext.Implicits.global

class N5ArrayExplorer extends RemoteLayerExplorer {

  override def name: String = "N5 Array"

  override def explore(remotePath: Path, credentials: Option[FileSystemCredentials]): Fox[List[(N5Layer, Vec3Double)]] =
    for {
      headerPath <- Fox.successful(remotePath.resolve(N5Header.FILENAME_ATTRIBUTES_JSON))
      name <- guessNameFromPath(remotePath)
      n5Header <- parseJsonFromPath[N5Header](headerPath) ?~> s"failed to read n5 header at $headerPath"
      elementClass <- n5Header.elementClass ?~> "failed to read element class from n5 header"
      guessedAxisOrder = AxisOrder.asZyxFromRank(n5Header.rank)
      boundingBox <- n5Header.boundingBox(guessedAxisOrder) ?~> "failed to read bounding box from zarr header. Make sure data is in (T/C)ZYX format"
      magLocator = MagLocator(Vec3Int.ones, Some(remotePath.toString), credentials, Some(guessedAxisOrder))
      layer: N5Layer = if (looksLikeSegmentationLayer(name, elementClass)) {
        N5SegmentationLayer(name, boundingBox, elementClass, List(magLocator), largestSegmentId = None)
      } else N5DataLayer(name, Category.color, boundingBox, elementClass, List(magLocator))
    } yield List((layer, Vec3Double(1.0, 1.0, 1.0)))

}
