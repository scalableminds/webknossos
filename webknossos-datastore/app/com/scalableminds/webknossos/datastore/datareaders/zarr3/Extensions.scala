package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import play.api.libs.json.{Json, OFormat}

case class ExtensionDataTypeFallback(
    name: String,
    configuration: Option[Map[String, String]]
)

object ExtensionDataTypeFallback extends JsonImplicits {
  implicit val extensionDataTypeFallbackFormat: OFormat[ExtensionDataTypeFallback] =
    Json.format[ExtensionDataTypeFallback]
}

case class ExtensionDataType(
    name: String,
    configuration: Map[String, String],
    fallback: Option[Seq[ExtensionDataTypeFallback]]
)

object ExtensionDataType extends JsonImplicits {
  implicit val extensionDataTypeFormat: OFormat[ExtensionDataType] =
    Json.format[ExtensionDataType]
}

case class ExtensionChunkGridSpecification(
    name: String,
    configuration: Option[Map[String, String]] // TODO
)

object ExtensionChunkGridSpecification extends JsonImplicits {
  implicit val extensionChunkGridSpecificationFormat: OFormat[ExtensionChunkGridSpecification] =
    Json.format[ExtensionChunkGridSpecification]
}
