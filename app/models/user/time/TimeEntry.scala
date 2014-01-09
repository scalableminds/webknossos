package models.user.time

import java.util.Date
import models.annotation.AnnotationLike
import play.api.libs.json.Json

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 28.10.13
 * Time: 00:58
 */
case class TimeEntry(time: Long, timestamp: Long, note: Option[String] = None, annotation: Option[String] = None) {

  val created = new Date(timestamp)

  def annotationEquals(other: String): Boolean =
    annotationEquals(Some(other))

  def annotationEquals(other: Option[String]): Boolean =
    annotation == other

  def addTime(duration: Long, timestamp: Long) =
    this.copy(time = time + duration, timestamp = timestamp)
}

object TimeEntry {
  implicit val timeEntryFormat = Json.format[TimeEntry]

  def create(timestamp: Long, annotation: Option[AnnotationLike]) =
    TimeEntry(0, timestamp, annotation = annotation.map(_.id))
}
