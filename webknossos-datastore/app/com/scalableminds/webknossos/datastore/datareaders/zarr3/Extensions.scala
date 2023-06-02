package com.scalableminds.webknossos.datastore.datareaders.zarr3

import play.api.libs.json.{Json, OFormat}

case class ExtensionDataTypeFallback(
    name: String,
    configuration: Option[Map[String, String]]
)

object ExtensionDataTypeFallback {
  implicit val jsonFormat: OFormat[ExtensionDataTypeFallback] =
    Json.format[ExtensionDataTypeFallback]
}

case class ExtensionDataType(
    name: String,
    configuration: Map[String, String],
    fallback: Option[Seq[ExtensionDataTypeFallback]]
)

object ExtensionDataType {
  implicit val jsonFormat: OFormat[ExtensionDataType] =
    Json.format[ExtensionDataType]
}

// This needs to replaced with concrete extensions (as with codecs)
case class ExtensionChunkGridSpecification(
    name: String,
    configuration: Option[Map[String, String]]
)

object ExtensionChunkGridSpecification {
  implicit val jsonFormat: OFormat[ExtensionChunkGridSpecification] =
    Json.format[ExtensionChunkGridSpecification]
}
