package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.webknossos.datastore.datareaders.zarr.NgffMetadataV0_5
import play.api.libs.json._

case class NgffZarr3GroupHeader(
    zarr_format: Int, // must be 3
    node_type: String, // must be "group"
    ngffMetadata: NgffMetadataV0_5,
)

object NgffZarr3GroupHeader {
  implicit object Zarr3GroupHeaderFormat extends Format[NgffZarr3GroupHeader] {
    override def reads(json: JsValue): JsResult[NgffZarr3GroupHeader] =
      for {
        zarr_format <- (json \ "zarr_format").validate[Int]
        node_type <- (json \ "node_type").validate[String]
        // Read the metadata from the correct json path.
        ngffMetadata <- (json \ "attributes" \ "ome").validate[NgffMetadataV0_5]
      } yield
        NgffZarr3GroupHeader(
          zarr_format,
          node_type,
          ngffMetadata,
        )

    override def writes(zarrArrayGroup: NgffZarr3GroupHeader): JsValue =
      Json.obj(
        "zarr_format" -> zarrArrayGroup.zarr_format,
        "node_type" -> zarrArrayGroup.node_type,
        // Enforce correct path for ngffMetadata in the json.
        "attributes" -> Json.obj("ome" -> zarrArrayGroup.ngffMetadata),
      )
  }
}
