package models.analytics

import models.basics.SecuredBaseDAO
import play.api.libs.json.{JsValue, Json}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

case class AnalyticsEntry(
                           user: Option[BSONObjectID],
                           namespace: String,
                           value: JsValue,
                           timestamp: Long = System.currentTimeMillis()
                         )

object AnalyticsEntry {
  implicit val analyticsEntryFormat = Json.format[AnalyticsEntry]
}

object AnalyticsDAO extends SecuredBaseDAO[AnalyticsEntry] {

  val collectionName = "analytics"

  implicit val formatter = AnalyticsEntry.analyticsEntryFormat
}
