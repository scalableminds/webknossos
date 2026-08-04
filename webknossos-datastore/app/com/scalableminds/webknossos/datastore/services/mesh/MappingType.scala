package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.enumeration.ExtendedEnumeration
import play.api.libs.json.{Format, JsError, JsPath, JsResult, JsString, JsSuccess, JsValue, JsonValidationError}

object MappingType extends ExtendedEnumeration {
  type MappingType = Value

  val JSON, AGGLOMERATE = Value

  private val legacyAgglomerateName = "HDF5"

  override def fromString(s: String): Option[Value] =
    if (s == legacyAgglomerateName) Some(AGGLOMERATE) else super.fromString(s)

  implicit override val format: Format[Value] = new Format[Value] {
    def reads(json: JsValue): JsResult[Value] =
      json.validate[String].flatMap { asString =>
        fromString(asString)
          .map(JsSuccess(_))
          .getOrElse(JsError(Seq(JsPath -> Seq(JsonValidationError(s"Error. Expected a enum valid value but got $asString.")))))
      }

    def writes(value: Value): JsValue = JsString(value.toString)
  }
}
