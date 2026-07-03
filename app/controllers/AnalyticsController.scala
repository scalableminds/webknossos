package controllers

import com.scalableminds.util.tools.Fox
import models.analytics.{AnalyticsEventsIngestJson, AnalyticsService, FrontendAnalyticsEvent}
import models.voxelytics.LokiClient
import play.api.libs.json.{JsObject, Json, OFormat}
import play.api.mvc.{Action, PlayBodyParsers}
import play.silhouette.api.Silhouette
import security.WkEnv
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class ReduxActionLogParameters(sessionId: String, entries: List[JsObject])
object ReduxActionLogParameters {
  implicit val jsonFormat: OFormat[ReduxActionLogParameters] = Json.format[ReduxActionLogParameters]
}

class AnalyticsController @Inject() (analyticsService: AnalyticsService,
                                      lokiClient: LokiClient,
                                      conf: WkConf,
                                      sil: Silhouette[WkEnv])(implicit
    ec: ExecutionContext,
    bodyParsers: PlayBodyParsers
) extends Controller {

  def ingestAnalyticsEvents: Action[AnalyticsEventsIngestJson] = Action.fox(validateJson[AnalyticsEventsIngestJson]) {
    implicit request =>
      for {
        _ <- Fox.fromBool(conf.BackendAnalytics.saveToDatabaseEnabled) ?~> "Database logging of events is not enabled"
        _ <- analyticsService.ingest(request.body.events, request.body.apiKey)
      } yield Ok
  }

  def trackAnalyticsEvent(eventType: String): Action[JsObject] = sil.UserAwareAction(validateJson[JsObject]) {
    implicit request =>
      request.identity.foreach { user =>
        analyticsService.track(FrontendAnalyticsEvent(user, eventType, request.body))
      }
      Ok
  }

  // Receives a batch of frontend redux actions and forwards them to Loki (if a Loki uri is configured).
  // SecuredAction since we need the user/organization for labelling; the frontend only sends when logged in.
  def logReduxActions: Action[ReduxActionLogParameters] =
    sil.SecuredAction.async(validateJson[ReduxActionLogParameters]) { implicit request =>
      for {
        _ <- lokiClient.bulkInsertActionLog(request.body.entries,
                                            request.identity._organization.toString,
                                            request.identity._id.toString,
                                            request.body.sessionId)
      } yield Ok
    }

}
