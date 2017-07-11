package models.user

import com.scalableminds.util.reactivemongo._
import models.basics._
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

case class UserAgentTracking(user: Option[BSONObjectID], userAgent: String, timestamp: Long)

object UserAgentTracking {
  val userAgentTrackingFormat = Json.format[UserAgentTracking]
}

object UserAgentTrackingDAO extends SecuredBaseDAO[UserAgentTracking] {
  val collectionName = "userAgentTracking"

  implicit val formatter = UserAgentTracking.userAgentTrackingFormat

  def trackUserAgent(user: Option[BSONObjectID], userAgent: String)(implicit ctx: DBAccessContext) =
    insert(UserAgentTracking(user, userAgent, System.currentTimeMillis))
}
