import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.BucketProvider
import com.scalableminds.webknossos.datastore.dataformats.zarr.{ZarrLayer, ZarrMag}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataFormat, DataLayerLike, ElementClass}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import play.api.libs.json.{Json, OFormat}

import java.io

trait ZarrAttrs {

  def multiscales: List[Map[String, Any]]
  def version: String = "0.4"
  def axes: List[Map[String, String]] = List(
    Map("name" -> "c", "type" -> "channel"),
    Map("name" -> "x", "type" -> "space", "unit" -> "nanometer"),
    Map("name" -> "y", "type" -> "space", "unit" -> "nanometer"),
    Map("name" -> "z", "type" -> "space", "unit" -> "nanometer")
  )
  def datasets: List[Map[String, io.Serializable]] =
    List(
      Map("path" -> "1",
          "coordinateTransformation" -> List(
            Map("type" -> "scale", "scale" -> List(1.0, 1.0, 1.0))
          )))
//  {
//    "multiscales": [
//    {
//      "version": "0.4",
//      "axes": [
//      { "name": "c", "type": "channel" },
//      { "name": "x", "type": "space", "unit": "nanometer" },
//      { "name": "y", "type": "space", "unit": "nanometer" },
//      { "name": "z", "type": "space", "unit": "nanometer" }
//      ],
//      "datasets": [
//      {
//        "path": "1-1-1",
//        "coordinateTransformations": [
//        {
//          "type": "scale",
//          "scale": [1.0, 11.24, 11.24, 28]
//        }
//        ]
//      },
//      {
//        "path": "2-2-1",
//        "coordinateTransformations": [
//        {
//          "type": "scale",
//          "scale": [1.0, 22.48, 22.48, 28]
//        }
//        ]
//      },
//      {
//        "path": "4-4-2",
//        "coordinateTransformations": [
//        {
//          "type": "scale",
//          "scale": [1.0, 44.96, 44.96, 56]
//        }
//        ]
//      }
//      ]
//    }
//    ]
//  }
}

object ZarrAttrs {
  implicit val jsonFormat: OFormat[ZarrAttrs] = Json.format[ZarrAttrs]
}
