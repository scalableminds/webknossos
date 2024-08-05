package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.webknossos.datastore.datareaders.zarr.NgffMetadataV0_5
import play.api.libs.json._

case class Zarr3GroupHeader(
    zarr_format: Int, // must be 3
    node_type: String, // must be "group"
    ngffMetadata: Option[NgffMetadataV0_5],
)

object Zarr3GroupHeader {
  implicit val jsonFormat: OFormat[Zarr3GroupHeader] = Json.format[Zarr3GroupHeader]
}
