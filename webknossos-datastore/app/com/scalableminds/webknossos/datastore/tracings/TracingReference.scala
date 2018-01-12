/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.tracings

import play.api.libs.json.{Format, Json, Reads, Writes}

object TracingType extends Enumeration {
  val skeleton, volume = Value

  def fromString(s: String): Option[Value] = values.find(_.toString == s)

  implicit val format = Format(Reads.enumNameReads(TracingType), Writes.enumNameWrites)
}

case class TracingReference(id: String, typ: TracingType.Value)

object TracingReference {
  implicit val jsonFormat = Json.format[TracingReference]
}
