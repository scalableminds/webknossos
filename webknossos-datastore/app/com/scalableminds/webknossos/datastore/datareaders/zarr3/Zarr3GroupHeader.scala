package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.tools.BoxImplicits
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3DataType.{Zarr3DataType, raw}
import com.scalableminds.webknossos.datastore.datareaders._
import com.scalableminds.webknossos.datastore.datareaders.zarr.NgffMetadataV2.jsonFormat
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffMetadata, NgffMetadataV2}
import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Full}
import play.api.libs.json._

import java.nio.ByteOrder

case class Zarr3GroupHeader(
    zarr_format: Int, // must be 3
    node_type: String, // must be "group"
    ngffMetadata: Option[NgffMetadataV2],
)

object Zarr3GroupHeader extends JsonImplicits {

  def FILENAME_ZARR_JSON = "zarr.json"
  implicit object Zarr3GroupHeaderFormat extends Format[Zarr3GroupHeader] {
    override def reads(json: JsValue): JsResult[Zarr3GroupHeader] =
      for {
        zarr_format <- (json \ "zarr_format").validate[Int]
        node_type <- (json \ "node_type").validate[String]
        ngffMetadata = (json \ "attributes" \ "ome").validate[NgffMetadataV2].asOpt
      } yield
        Zarr3GroupHeader(
          zarr_format,
          node_type,
          ngffMetadata,
        )

    override def writes(zarr3GroupHeader: Zarr3GroupHeader): JsValue = {
      val groupHeaderBuilder = Json.newBuilder
      groupHeaderBuilder ++= Seq(
        "zarr_format" -> zarr3GroupHeader.zarr_format,
        "node_type" -> zarr3GroupHeader.node_type,
      )
      if (zarr3GroupHeader.ngffMetadata.isDefined) {
        groupHeaderBuilder += ("attributes" -> Json.obj("ome" -> zarr3GroupHeader.ngffMetadata.get))
      }
      groupHeaderBuilder.result()
    }
  }
}
