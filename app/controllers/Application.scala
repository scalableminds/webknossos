package controllers

import javax.inject.Inject

import oxalis.security.WebknossosSilhouette.{UserAwareAction, SecuredAction}
import models.analytics.{AnalyticsDAO, AnalyticsEntry}
import play.api.i18n.MessagesApi
import play.api.libs.json.Json
import play.twirl.api.Html

class Application @Inject()(val messagesApi: MessagesApi) extends Controller{

  def buildInfo = UserAwareAction { implicit request =>
    Ok(Json.obj(
      "webknossos" -> webknossos.BuildInfo.toMap.mapValues(_.toString),
      "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString)
    ))
  }

  def analytics(namespace: String) = UserAwareAction(parse.json(1024 * 1024)) { implicit request =>
    AnalyticsDAO.insert(
      AnalyticsEntry(
        request.identity.map(_._id),
        namespace,
        request.body))
    Ok
  }
}
