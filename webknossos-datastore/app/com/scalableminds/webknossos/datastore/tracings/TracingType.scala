package com.scalableminds.webknossos.datastore.tracings

import play.api.libs.json.{Format, Json, Reads, Writes}

object TracingType extends Enumeration {
  val skeleton, volume, hybrid = Value

  def fromString(s: String): Option[Value] = values.find(_.toString == s)

  implicit val format = Format(Reads.enumNameReads(TracingType), Writes.enumNameWrites)
}
