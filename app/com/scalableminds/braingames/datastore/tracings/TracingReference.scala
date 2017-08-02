package com.scalableminds.braingames.datastore.tracings

import play.api.libs.json.{Format, Json, Reads, Writes}

/**
  * Created by jfrohnhofen on 8/2/17.
  */

object TracingType extends Enumeration {
  val skeletonTracing, volumeTracing = Value

  implicit val tracingTypeFormat = Format(Reads.enumNameReads(TracingType), Writes.enumNameWrites)
}

case class TracingReference(id: String, contentType: TracingType.Value)

object TracingReference {
  implicit val jsonFormat = Json.format[TracingReference]
}
