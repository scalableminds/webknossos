package com.scalableminds.webknossos.tracingstore.tracings

import play.api.libs.json._

object TracingType extends Enumeration {
  val skeleton, volume, hybrid = Value

  def fromString(s: String): Option[Value] = values.find(_.toString == s)

  implicit val format: Format[TracingType.Value] = Format(Reads.enumNameReads(TracingType), Writes.enumNameWrites)
}
