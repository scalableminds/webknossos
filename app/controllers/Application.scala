package controllers

import javax.inject.Inject

import oxalis.security.WebknossosSilhouette.UserAwareAction
import models.analytics.{AnalyticsDAO, AnalyticsEntry}
import models.binary.DataStoreHandlingStrategy
import play.api.i18n.MessagesApi
import play.api.libs.json.Json

class Application @Inject()(val messagesApi: MessagesApi) extends Controller{

  def buildInfo = UserAwareAction { implicit request =>
    val token = request.identity.flatMap { user =>
      if (user.isSuperUser) Some(DataStoreHandlingStrategy.webKnossosToken) else None
    }
    Ok(Json.obj(
      "webknossos" -> webknossos.BuildInfo.toMap.mapValues(_.toString),
      "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString),
      "token" -> token
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
