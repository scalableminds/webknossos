/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.datastore.tracings

import play.api.libs.json.{Format, Json, Reads, Writes}


object TracingType extends Enumeration {
  val skeleton, volume = Value

  implicit val tracingTypeFormat = Format(Reads.enumNameReads(TracingType), Writes.enumNameWrites)
}

case class TracingReference(id: String, typ: TracingType.Value)

object TracingReference {
  implicit val jsonFormat = Json.format[TracingReference]
}
