package controllers

import javax.inject.Inject
import com.typesafe.config.ConfigRenderOptions
import oxalis.security.WebknossosSilhouette.UserAwareAction
import models.analytics.{AnalyticsEntrySQL, AnalyticsSQLDAO}
import models.binary.DataStoreHandlingStrategy
import play.api.i18n.MessagesApi
import play.api.Play.current
import play.api.libs.json.Json
import utils.ObjectId

class Application @Inject()(val messagesApi: MessagesApi) extends Controller {

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
    AnalyticsSQLDAO.insertOne(
      AnalyticsEntrySQL(
        ObjectId.generate,
        request.identity.map(user => ObjectId.fromBsonId(user._id)),
        namespace,
        request.body))
    Ok
  }

  def features = UserAwareAction { implicit request =>
    Ok(current.configuration.underlying.getConfig("features").resolve.root.render(ConfigRenderOptions.concise()))
  }

}
