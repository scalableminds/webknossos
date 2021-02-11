package models.analytics

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.user.User
import org.joda.time.DateTime
import play.api.libs.json._
import utils.WkConf

import scala.concurrent.ExecutionContext

class AnalyticsService @Inject()(rpc: RPC, wkConf: WkConf)(implicit ec: ExecutionContext) extends LazyLogging {
  def note(analyticsEvent: AnalyticsEvent): Unit = {
    noteBlocking(analyticsEvent)
    ()
  }

  private def noteBlocking(analyticsEvent: AnalyticsEvent): Fox[Unit] = {
    for {
      analyticsJson <- analyticsEvent.toJson
      _ <- send(analyticsJson)
    } yield ()
  }

  private def send(analyticsJson: JsObject): Fox[Unit] = {
    if (wkConf.BackendAnalytics.uri == "") {
      logger.info(s"Not sending Analytics event, since uri is not configured. Event was: $analyticsJson")
    } else {
      // TODO: send POST request
    }
    Fox.successful(())
  }
}

trait AnalyticsEvent {
  def eventType: String
  def userId: String
  def eventProperties: JsObject
  def userProperties: JsObject = Json.obj("organization_id" -> user._organization)
  def timestamp: String = DateTime.now().getMillis.toString

  def user: User

  def toJson(implicit ec: ExecutionContext): Fox[JsObject] = {
    Fox.successful(
      Json.obj(
        "event_type" -> eventType,
        "user_id" -> userId,
        "user_properties" -> userProperties,
        "event_properties" -> eventProperties,
      )
    )
  }
}

case class SignupEvent(user: User, hadInvite: Boolean) extends AnalyticsEvent {
  def eventType: String = "signup"
  def userId: String = user._multiUser.toString
  def eventProperties: JsObject = Json.obj("had_invite" -> hadInvite)
}
