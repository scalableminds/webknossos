package models.analytics

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.annotation.Annotation
import models.binary.DataSet
import models.team.Organization
import models.user.{User, UserDAO}
import org.joda.time.DateTime
import play.api.libs.json._
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext

class AnalyticsLookUpService @Inject()(userDAO: UserDAO) extends LazyLogging {
  def multiUserIdFor(userId: ObjectId): Fox[String] = for {
    user <- userDAO.findOne(userId)(GlobalAccessContext)
  } yield user._multiUser.id
}

class AnalyticsService @Inject()(rpc: RPC, wkConf: WkConf, analyticsLookUpService: AnalyticsLookUpService)(implicit ec: ExecutionContext) extends LazyLogging {
  def note(analyticsEvent: AnalyticsEvent): Unit = {
    noteBlocking(analyticsEvent)
    ()
  }

  private def noteBlocking(analyticsEvent: AnalyticsEvent): Fox[Unit] =
    for {
      analyticsJson <- analyticsEvent.toJson(analyticsLookUpService)
      _ <- send(analyticsJson)
    } yield ()

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
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject]
  def userId: String = user._multiUser.toString
  def userProperties: JsObject = Json.obj("organization_id" -> user._organization.id)
  def timestamp: String = DateTime.now().getMillis.toString

  def user: User

  def toJson(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    for {
      eventProperties <- eventProperties(analyticsLookUpService)
    } yield {
      Json.obj(
        "event_type" -> eventType,
        "user_id" -> userId,
        "user_properties" -> userProperties,
        "event_properties" -> eventProperties,
      )
    }
}

case class SignupEvent(user: User, hadInvite: Boolean)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "signup"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] = Fox.successful(Json.obj("had_invite" -> hadInvite))
}

case class InviteEvent(user: User, recipientCount: Int)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "send_invites"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("recipient_count" -> recipientCount))
}

case class JoinOrganizationEvent(user: User, organization: Organization)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "join_organization"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("joined_organization_id" -> organization._id.id))
}

case class CreateAnnotationEvent(user: User, annotation: Annotation)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "create_annotation"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("annotation_id" -> annotation._id.id,
      "annotation_dataset_id" -> annotation._dataSet.id))
}

case class OpenAnnotationEvent(user: User, annotation: Annotation) extends AnalyticsEvent {
  def eventType: String = "open_annotation"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    for {
      owner_multiuser_id <- analyticsLookUpService.multiUserIdFor(annotation._user)
    } yield {
      Json.obj("annotation_id" -> annotation._id.id,
      "annotation_owner_multiuser_id" -> owner_multiuser_id,
      "annotation_dataset_id" -> annotation._dataSet.id)
    }
}

case class OpenDatasetEvent(user: User, dataSet: DataSet)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "open_dataset"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    for {
      uploader_multiuser_id <- Fox.runOptional(dataSet._uploader)(uploader => analyticsLookUpService.multiUserIdFor(uploader))
    } yield {
      Json.obj("dataset_id" -> dataSet._id,
        "dataset_name" -> dataSet.name,
        "dataset_organization_id" -> dataSet._organization.id,
        "dataset_uploader_multiuser_id" -> uploader_multiuser_id)
    }
}

case class RunJobEvent(user: User, command: String)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "run_job"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("command" -> command))
}
