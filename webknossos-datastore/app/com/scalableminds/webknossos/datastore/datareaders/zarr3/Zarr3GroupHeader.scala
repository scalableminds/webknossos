package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.webknossos.datastore.datareaders.zarr.NgffMetadataV0_5
import com.scalableminds.webknossos.datastore.services.mesh.MeshfileAttributes
import play.api.libs.json._

case class Zarr3GroupHeader(
    zarr_format: Int, // must be 3
    node_type: String, // must be "group"
    ngffMetadata: Option[NgffMetadataV0_5],
    meshfileAttributes: Option[MeshfileAttributes]
)

object Zarr3GroupHeader {
  def FILENAME_ZARR_JSON = "zarr.json"

  implicit object Zarr3GroupHeaderFormat extends Format[Zarr3GroupHeader] {
    override def reads(json: JsValue): JsResult[Zarr3GroupHeader] =
      for {
        zarr_format <- (json \ "zarr_format").validate[Int]
        node_type <- (json \ "node_type").validate[String]
        // Read the metadata from the correct json path.
        ngffMetadata <- (json \ "attributes" \ "ome").validateOpt[NgffMetadataV0_5]
        // TODO unify. also, include in Writes
        meshfileAttributes <- (json \ "attributes").validateOpt[MeshfileAttributes]
      } yield
        Zarr3GroupHeader(
          zarr_format,
          node_type,
          ngffMetadata,
          meshfileAttributes
        )

    override def writes(zarrArrayGroup: Zarr3GroupHeader): JsValue =
      Json.obj(
        "zarr_format" -> zarrArrayGroup.zarr_format,
        "node_type" -> zarrArrayGroup.node_type,
        // Enforce correct path for ngffMetadata in the json.
        "attributes" -> Json.obj("ome" -> zarrArrayGroup.ngffMetadata),
      )
  }
}
