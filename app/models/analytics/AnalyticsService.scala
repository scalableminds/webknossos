package models.analytics

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.annotation.Annotation
import models.binary.{DataSet, DataStore}
import models.organization.Organization
import models.user.{MultiUserDAO, User, UserDAO}
import org.joda.time.DateTime
import play.api.libs.json._
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class AnalyticsService @Inject()(rpc: RPC,
                                 wkConf: WkConf,
                                 analyticsLookUpService: AnalyticsLookUpService,
                                 analyticsSessionService: AnalyticsSessionService)(implicit ec: ExecutionContext)
    extends LazyLogging {

  def track(analyticsEvent: AnalyticsEvent): Unit = {
    for {
      sessionId <- Fox.successful(analyticsSessionService.refreshAndGetSessionId(analyticsEvent.user._multiUser))
      analyticsJson <- analyticsEvent.toJson(analyticsLookUpService, sessionId)
      _ <- send(analyticsJson)
    } yield ()
    () // Do not return the Future, so as to not block caller
  }

  private def send(analyticsEventJson: JsObject): Fox[Unit] = {
    if (wkConf.BackendAnalytics.uri == "" || wkConf.BackendAnalytics.key == "") {
      if (wkConf.BackendAnalytics.verboseLoggingEnabled) {
        logger.info(s"Not sending analytics event, since uri/key is not configured. Event was: $analyticsEventJson")
      }
    } else {
      if (wkConf.BackendAnalytics.verboseLoggingEnabled) {
        logger.info(s"Sending analytics event: $analyticsEventJson")
      }
      val wrappedJson = Json.obj("api_key" -> wkConf.BackendAnalytics.key, "events" -> List(analyticsEventJson))
      rpc(wkConf.BackendAnalytics.uri).silent.postJson(wrappedJson)
    }
    Fox.successful(())
  }
}

class AnalyticsLookUpService @Inject()(userDAO: UserDAO, multiUserDAO: MultiUserDAO, wkConf: WkConf)
    extends LazyLogging {
  implicit val ctx: DBAccessContext = GlobalAccessContext

  def isSuperUser(multiUserId: ObjectId): Fox[Boolean] =
    for {
      multiUser <- multiUserDAO.findOne(multiUserId)
    } yield multiUser.isSuperUser

  def multiUserIdFor(userId: ObjectId): Fox[String] =
    for {
      user <- userDAO.findOne(userId)
    } yield user._multiUser.id

  def webknossos_uri: String = wkConf.Http.uri
}

class AnalyticsSessionService @Inject()(wkConf: WkConf) extends LazyLogging {
  // Maintains session IDs per multiUser. The value is the start time of the session.
  // After an inactivity pause a new session id is assigned.

  // After this duration of inactivity, a new session ID is generated for a user
  private lazy val pause: FiniteDuration = wkConf.BackendAnalytics.sessionPause

  // format: userId → (lastRefreshTimestamp, sessionId)
  private lazy val sessionIdStore: scala.collection.mutable.Map[ObjectId, (Long, Long)] = scala.collection.mutable.Map()

  def refreshAndGetSessionId(multiUserId: ObjectId): Long = {
    val now: Long = System.currentTimeMillis()
    sessionIdStore.synchronized {
      val valueOld = sessionIdStore.getOrElse(multiUserId, (-1L, -1L))
      val idToSet = if (valueOld._1 + pause.toMillis < now) now else valueOld._2
      sessionIdStore.put(multiUserId, (now, idToSet))
      idToSet
    }
  }

}

trait AnalyticsEvent {
  def eventType: String
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject]
  def userId: String = user._multiUser.toString
  def userProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    for {
      isSuperUser <- analyticsLookUpService.isSuperUser(user._multiUser)
    } yield {
      Json.obj(
        "organization_id" -> user._organization.id,
        "is_organization_admin" -> user.isAdmin,
        "is_superuser" -> isSuperUser,
        "webknossos_uri" -> analyticsLookUpService.webknossos_uri
      )
    }
  def timestamp: String = DateTime.now().getMillis.toString

  def user: User

  def toJson(analyticsLookUpService: AnalyticsLookUpService, sessionId: Long): Fox[JsObject] =
    for {
      eventProperties <- eventProperties(analyticsLookUpService)
      userProperties <- userProperties(analyticsLookUpService)
    } yield {
      Json.obj(
        "event_type" -> eventType,
        "user_id" -> userId,
        "time" -> timestamp,
        "user_properties" -> userProperties,
        "event_properties" -> eventProperties,
        "session_id" -> sessionId
      )
    }
}

case class SignupEvent(user: User, hadInvite: Boolean)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "signup"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("had_invite" -> hadInvite))
}

case class InviteEvent(user: User, recipientCount: Int)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "send_invites"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("recipient_count" -> recipientCount))
}

case class JoinOrganizationEvent(user: User, organization: Organization)(implicit ec: ExecutionContext)
    extends AnalyticsEvent {
  def eventType: String = "join_organization"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("joined_organization_id" -> organization._id.id))
}

case class CreateAnnotationEvent(user: User, annotation: Annotation)(implicit ec: ExecutionContext)
    extends AnalyticsEvent {
  def eventType: String = "create_annotation"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("annotation_id" -> annotation._id.id, "annotation_dataset_id" -> annotation._dataSet.id))
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

case class UploadAnnotationEvent(user: User, annotation: Annotation)(implicit ec: ExecutionContext)
    extends AnalyticsEvent {
  def eventType: String = "upload_annotation"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("annotation_id" -> annotation._id.id))
}

case class DownloadAnnotationEvent(user: User, annotationId: String, annotationType: String)(
    implicit ec: ExecutionContext)
    extends AnalyticsEvent {
  def eventType: String = "download_annotation"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("annotation_id" -> annotationId, "annotation_type" -> annotationType))
}

case class UpdateAnnotationEvent(user: User, annotation: Annotation, changesCount: Int)(implicit ec: ExecutionContext)
    extends AnalyticsEvent {
  def eventType: String = "update_annotation"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("annotation_id" -> annotation._id.id, "changes_count" -> changesCount))
}

case class UpdateAnnotationViewOnlyEvent(user: User, annotation: Annotation, changesCount: Int)(
    implicit ec: ExecutionContext)
    extends AnalyticsEvent {
  def eventType: String = "update_annotation_view_only"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("annotation_id" -> annotation._id.id, "changes_count" -> changesCount))
}

case class OpenDatasetEvent(user: User, dataSet: DataSet)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "open_dataset"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    for {
      uploader_multiuser_id <- Fox.runOptional(dataSet._uploader)(uploader =>
        analyticsLookUpService.multiUserIdFor(uploader))
    } yield {
      Json.obj(
        "dataset_id" -> dataSet._id.id,
        "dataset_name" -> dataSet.name,
        "dataset_organization_id" -> dataSet._organization.id,
        "dataset_uploader_multiuser_id" -> uploader_multiuser_id
      )
    }
}

case class RunJobEvent(user: User, command: String)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "run_job"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("command" -> command))
}

case class FailedJobEvent(user: User, command: String)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "failed_job"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("command" -> command))
}

case class UploadDatasetEvent(user: User, dataSet: DataSet, dataStore: DataStore, dataSetSizeBytes: Long)(
    implicit ec: ExecutionContext)
    extends AnalyticsEvent {
  def eventType: String = "upload_dataset"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "dataset_id" -> dataSet._id.id,
        "dataset_name" -> dataSet.name,
        "dataset_size_bytes" -> dataSetSizeBytes,
        "datastore_uri" -> dataStore.publicUrl,
        "dataset_organization_id" -> dataSet._organization.id
      ))
}

case class ChangeDatasetSettingsEvent(user: User, dataSet: DataSet)(implicit ec: ExecutionContext)
    extends AnalyticsEvent {
  def eventType: String = "change_dataset_settings"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("dataset_id" -> dataSet._id.id))
}

case class FrontendAnalyticsEvent(user: User, eventType: String, eventProperties: JsObject)(
    implicit ec: ExecutionContext)
    extends AnalyticsEvent {
  override def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(eventProperties ++ Json.obj("is_frontend_event" -> true))
}
