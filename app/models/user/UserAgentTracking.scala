package models.user

import models.basics._
import reactivemongo.bson.BSONObjectID
import play.api.libs.json.Json
import play.modules.reactivemongo.json.BSONFormats._
import com.scalableminds.util.reactivemongo._

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
