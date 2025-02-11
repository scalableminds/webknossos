package models.analytics

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import models.annotation.Annotation
import models.dataset.{DataStore, Dataset}
import models.job.JobCommand.JobCommand
import models.organization.Organization
import models.user.User
import play.api.libs.json._
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

trait AnalyticsEvent {
  def eventType: String
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject]
  def userId: ObjectId = user._multiUser
  def userProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[AnalyticsEventJsonUserProperties] =
    for {
      isSuperUser <- analyticsLookUpService.isSuperUser(user._multiUser)
    } yield AnalyticsEventJsonUserProperties(
      user._organization,
      user.isAdmin,
      isSuperUser,
      analyticsLookUpService.webknossos_uri
    )

  def user: User

  def toJson(analyticsLookUpService: AnalyticsLookUpService, sessionId: Long): Fox[AnalyticsEventJson] =
    for {
      eventProperties <- eventProperties(analyticsLookUpService)
      userProperties <- userProperties(analyticsLookUpService)
    } yield AnalyticsEventJson(eventType, userId, Instant.now, userProperties, eventProperties, sessionId)
}

case class AnalyticsEventJsonUserProperties(
    organizationId: String,
    isOrganizationAdmin: Boolean,
    isSuperUser: Boolean,
    webknossosUri: String
)

object AnalyticsEventJsonUserProperties {
  implicit val jsonWrites: OWrites[AnalyticsEventJsonUserProperties] = Json.writes[AnalyticsEventJsonUserProperties]

  implicit object analyticsEventJsonUserPropertiesReads extends Reads[AnalyticsEventJsonUserProperties] {
    override def reads(json: JsValue): JsResult[AnalyticsEventJsonUserProperties] = {
      val organizationIdLookup = (json \ "organization_id").orElse(json \ "organizationId")
      for {
        organizationId <- organizationIdLookup.validate[String]
        isOrganizationAdmin <- (json \ "is_organization_admin").orElse(json \ "isOrganizationAdmin").validate[Boolean]
        isSuperUser <- (json \ "is_superuser").orElse(json \ "isSuperUser").validate[Boolean]
        webknossosUri <- (json \ "webknossos_uri").orElse(json \ "webknossosUri").validate[String]
      } yield AnalyticsEventJsonUserProperties(organizationId, isOrganizationAdmin, isSuperUser, webknossosUri)
    }
  }
}

case class AnalyticsEventJson(
    eventType: String,
    userId: ObjectId,
    time: Instant,
    userProperties: AnalyticsEventJsonUserProperties,
    eventProperties: JsObject,
    sessionId: Long
)

object AnalyticsEventJson {
  implicit val jsonWrites: OWrites[AnalyticsEventJson] = Json.writes[AnalyticsEventJson]
  implicit object analyticsEventJsonReads extends Reads[AnalyticsEventJson] {
    override def reads(json: JsValue): JsResult[AnalyticsEventJson] =
      for {
        eventType <- (json \ "event_type").orElse(json \ "eventType").validate[String]
        userId <- (json \ "user_id").orElse(json \ "userId").validate[ObjectId]
        time <- (json \ "time").validate[Instant]
        userProperties <- (json \ "user_properties")
          .orElse(json \ "userProperties")
          .validate[AnalyticsEventJsonUserProperties]
        eventProperties <- (json \ "event_properties").orElse(json \ "eventProperties").validate[JsObject]
        sessionId <- (json \ "session_id").orElse(json \ "sessionId").validate[Long]
      } yield AnalyticsEventJson(
        eventType,
        userId,
        time,
        userProperties,
        eventProperties,
        sessionId
      )

  }
}

case class AnalyticsEventsIngestJson(events: List[AnalyticsEventJson], apiKey: String)

object AnalyticsEventsIngestJson {
  implicit val jsonWrites: OWrites[AnalyticsEventsIngestJson] = Json.writes[AnalyticsEventsIngestJson]

  implicit object analyticsEventJsonReads extends Reads[AnalyticsEventsIngestJson] {
    override def reads(json: JsValue): JsResult[AnalyticsEventsIngestJson] =
      for {
        events <- (json \ "events").validate[List[AnalyticsEventJson]]
        apiKey <- (json \ "api_key").orElse(json \ "apiKey").validate[String]
      } yield AnalyticsEventsIngestJson(events, apiKey)

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
    Fox.successful(Json.obj("joined_organization_id" -> organization._id))
}

case class CreateAnnotationEvent(user: User, annotation: Annotation)(implicit ec: ExecutionContext)
    extends AnalyticsEvent {
  def eventType: String = "create_annotation"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("annotation_id" -> annotation._id.id, "annotation_dataset_id" -> annotation._dataset.id))
}

case class OpenAnnotationEvent(user: User, annotation: Annotation) extends AnalyticsEvent {
  def eventType: String = "open_annotation"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    for {
      owner_multiuser_id <- analyticsLookUpService.multiUserIdFor(annotation._user)
    } yield Json.obj(
      "annotation_id" -> annotation._id.id,
      "annotation_owner_multiuser_id" -> owner_multiuser_id,
      "annotation_dataset_id" -> annotation._dataset.id
    )
}

case class UploadAnnotationEvent(user: User, annotation: Annotation)(implicit ec: ExecutionContext)
    extends AnalyticsEvent {
  def eventType: String = "upload_annotation"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("annotation_id" -> annotation._id.id))
}

case class DownloadAnnotationEvent(user: User, annotationId: String, annotationType: String)(implicit
    ec: ExecutionContext
) extends AnalyticsEvent {
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

case class UpdateAnnotationViewOnlyEvent(user: User, annotation: Annotation, changesCount: Int)(implicit
    ec: ExecutionContext
) extends AnalyticsEvent {
  def eventType: String = "update_annotation_view_only"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("annotation_id" -> annotation._id.id, "changes_count" -> changesCount))
}

case class OpenDatasetEvent(user: User, dataset: Dataset)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "open_dataset"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    for {
      uploader_multiuser_id <- Fox.runOptional(dataset._uploader)(uploader =>
        analyticsLookUpService.multiUserIdFor(uploader)
      )
    } yield Json.obj(
      "dataset_id" -> dataset._id.id,
      "dataset_name" -> dataset.name,
      "dataset_organization_id" -> dataset._organization,
      "dataset_uploader_multiuser_id" -> uploader_multiuser_id
    )
}

case class RunJobEvent(user: User, command: JobCommand)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "run_job"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("command" -> command.toString))
}

case class FailedJobEvent(user: User, command: JobCommand)(implicit ec: ExecutionContext) extends AnalyticsEvent {
  def eventType: String = "failed_job"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("command" -> command.toString))
}

case class UploadDatasetEvent(user: User, dataset: Dataset, dataStore: DataStore, datasetSizeBytes: Long)(implicit
    ec: ExecutionContext
) extends AnalyticsEvent {
  def eventType: String = "upload_dataset"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "dataset_id" -> dataset._id.id,
        "dataset_name" -> dataset.name,
        "dataset_size_bytes" -> datasetSizeBytes,
        "datastore_uri" -> dataStore.publicUrl,
        "dataset_organization_id" -> dataset._organization
      )
    )
}

case class ChangeDatasetSettingsEvent(user: User, dataset: Dataset)(implicit ec: ExecutionContext)
    extends AnalyticsEvent {
  def eventType: String = "change_dataset_settings"
  def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(Json.obj("dataset_id" -> dataset._id.id))
}

case class FrontendAnalyticsEvent(user: User, eventType: String, eventProperties: JsObject)(implicit
    ec: ExecutionContext
) extends AnalyticsEvent {
  override def eventProperties(analyticsLookUpService: AnalyticsLookUpService): Fox[JsObject] =
    Fox.successful(eventProperties ++ Json.obj("is_frontend_event" -> true))
}
