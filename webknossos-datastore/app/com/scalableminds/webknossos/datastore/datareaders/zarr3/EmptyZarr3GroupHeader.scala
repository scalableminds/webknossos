package com.scalableminds.webknossos.datastore.datareaders.zarr3

import play.api.libs.json.{Json, OFormat}

case class EmptyZarr3GroupHeader(
    zarr_format: Int, // must be 3
    node_type: String // must be "group"
)

object EmptyZarr3GroupHeader {
  implicit val jsonFormat: OFormat[EmptyZarr3GroupHeader] = Json.format[EmptyZarr3GroupHeader]
}
