package controllers

import com.scalableminds.util.tools.Fox
import models.analytics.{AnalyticsEventsIngestJson, AnalyticsService, FrontendAnalyticsEvent}
import play.api.libs.json.JsObject
import play.api.mvc.{Action, PlayBodyParsers}
import play.silhouette.api.Silhouette
import security.WkEnv
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class AnalyticsController @Inject()(analyticsService: AnalyticsService, conf: WkConf, sil: Silhouette[WkEnv])(
    implicit ec: ExecutionContext,
    bodyParsers: PlayBodyParsers)
    extends Controller {

  def ingestAnalyticsEvents: Action[AnalyticsEventsIngestJson] = Action.async(validateJson[AnalyticsEventsIngestJson]) {
    implicit request =>
      {
        for {
          _ <- Fox.fromBool(conf.BackendAnalytics.saveToDatabaseEnabled) ?~> "Database logging of events is not enabled"
          _ <- analyticsService.ingest(request.body.events, request.body.apiKey)
        } yield Ok
      }
  }

  def trackAnalyticsEvent(eventType: String): Action[JsObject] = sil.UserAwareAction(validateJson[JsObject]) {
    implicit request =>
      request.identity.foreach { user =>
        analyticsService.track(FrontendAnalyticsEvent(user, eventType, request.body))
      }
      Ok
  }

}
