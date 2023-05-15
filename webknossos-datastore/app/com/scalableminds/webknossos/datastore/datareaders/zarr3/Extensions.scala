package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import play.api.libs.json.{Format, JsResult, JsValue, Json}
import play.api.libs.json.Json.WithDefaultValues

case class ExtensionDataTypeFallback(
    name: String,
    configuration: Option[Map[String, String]]
)

object ExtensionDataTypeFallback extends JsonImplicits {
  implicit object ExtensionDataTypeFallbackFormat extends Format[ExtensionDataTypeFallback] {
    override def reads(json: JsValue): JsResult[ExtensionDataTypeFallback] =
      Json.using[WithDefaultValues].reads[ExtensionDataTypeFallback].reads(json)

    override def writes(obj: ExtensionDataTypeFallback): JsValue =
      Json.writes[ExtensionDataTypeFallback].writes(obj)
  }
}

case class ExtensionDataType(
    name: String,
    configuration: Map[String, String],
    fallback: Option[Seq[ExtensionDataTypeFallback]]
)

object ExtensionDataType extends JsonImplicits {
  implicit object ExtensionDataTypeFormat extends Format[ExtensionDataType] {
    override def reads(json: JsValue): JsResult[ExtensionDataType] =
      Json.using[WithDefaultValues].reads[ExtensionDataType].reads(json)

    override def writes(obj: ExtensionDataType): JsValue =
      Json.writes[ExtensionDataType].writes(obj)
  }
}

case class ExtensionChunkGridSpecification(
    name: String,
    configuration: Option[Map[String, String]] // TODO
)

object ExtensionChunkGridSpecification extends JsonImplicits {
  implicit object ExtensionChunkGridSpecificationFormat extends Format[ExtensionChunkGridSpecification] {
    override def reads(json: JsValue): JsResult[ExtensionChunkGridSpecification] =
      Json.using[WithDefaultValues].reads[ExtensionChunkGridSpecification].reads(json)

    override def writes(obj: ExtensionChunkGridSpecification): JsValue =
      Json.writes[ExtensionChunkGridSpecification].writes(obj)
  }
}
