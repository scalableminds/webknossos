package com.scalableminds.util.enumeration

import com.scalableminds.util.tools.{Fox, OxImplicits}
import com.scalableminds.util.tools.TextUtils.parseCommaSeparated
import play.api.libs.json.{Format, Json}

import scala.concurrent.ExecutionContext

abstract class ExtendedEnumeration extends Enumeration with OxImplicits {
  implicit val format: Format[Value] = Json.formatEnum(this)
  def fromString(s: String): Option[Value] =
    values.find(_.toString == s)

  def fromCommaSeparated(valuesStr: String)(implicit ec: ExecutionContext): Fox[List[Value]] =
    parseCommaSeparated(Some(valuesStr)) { typ: String =>
      fromString(typ).toFox
    }
}
