package models.dataset.explore

import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.zarr.{ZarrDataLayer, ZarrLayer, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataSource}

import scala.concurrent.ExecutionContext

class WebknossosZarrExplorer(implicit val ec: ExecutionContext) extends RemoteLayerExplorer {

  override def name: String = "WEBKNOSSOS-based Zarr"

  override def explore(remotePath: VaultPath, credentialId: Option[String]): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      dataSourcePropertiesPath <- Fox.successful(remotePath / "datasource-properties.json")
      dataSource <- parseJsonFromPath[DataSource](dataSourcePropertiesPath)
      ngffExplorer = new NgffExplorer
      zarrLayers <- Fox.serialCombined(dataSource.dataLayers) {
        case l: ZarrSegmentationLayer =>
          for {
            zarrLayersFromNgff <- ngffExplorer.explore(remotePath / l.name, credentialId)
          } yield
            zarrLayersFromNgff.map(
              zarrLayer =>
                (ZarrSegmentationLayer(zarrLayer._1.name,
                                       l.boundingBox,
                                       zarrLayer._1.elementClass,
                                       zarrLayer._1.mags,
                                       largestSegmentId = l.largestSegmentId),
                 zarrLayer._2))
        case l: ZarrDataLayer =>
          for {
            zarrLayersFromNgff <- ngffExplorer.explore(remotePath / l.name, credentialId)
          } yield
            zarrLayersFromNgff.map(
              zarrLayer =>
                (ZarrDataLayer(zarrLayer._1.name,
                               Category.color,
                               l.boundingBox,
                               zarrLayer._1.elementClass,
                               zarrLayer._1.mags,
                               additionalAxes = None),
                 zarrLayer._2))
        case layer => Fox.failure(s"Only remote Zarr layers are supported, got ${layer.getClass}.")
      }
    } yield zarrLayers.flatten

}
