package com.scalableminds.util.enumeration

import play.api.libs.json.{Format, Json}

abstract class ExtendedEnumeration extends Enumeration {
  implicit val format: Format[Value] = Json.formatEnum(this)
  def fromString(s: String): Option[Value] = values.find(_.toString == s)
}
