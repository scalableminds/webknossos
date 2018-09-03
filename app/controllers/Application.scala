package controllers

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import com.typesafe.config.ConfigRenderOptions
import oxalis.security.WebknossosSilhouette.UserAwareAction
import models.analytics.{AnalyticsEntry, AnalyticsSQL}
import models.binary.DataStoreHandler
import play.api.i18n.MessagesApi
import play.api.Play.current
import play.api.libs.json.Json
import play.api.libs.concurrent.Execution.Implicits._
import utils.SimpleSQLDAO
import slick.jdbc.PostgresProfile.api._
import utils.ObjectId

class Application @Inject()(val messagesApi: MessagesApi) extends Controller {

  def buildInfo = UserAwareAction.async { implicit request =>
    val token = request.identity.flatMap { user =>
      if (user.isSuperUser) Some(DataStoreHandler.webKnossosToken) else None
    }
    for {
      schemaVersion <- ReleaseInformationDAO.getSchemaVersion.futureBox
    } yield {
      Ok(Json.obj(
        "webknossos" -> webknossos.BuildInfo.toMap.mapValues(_.toString),
        "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString),
        "schemaVersion" -> schemaVersion.toOption,
        "token" -> token
      ))
    }
  }

  def analytics(namespace: String) = UserAwareAction(parse.json(1024 * 1024)) { implicit request =>
    AnalyticsSQL.insertOne(
      AnalyticsEntry(
        ObjectId.generate,
        request.identity.map(_._id),
        namespace,
        request.body))
    Ok
  }

  def features = UserAwareAction { implicit request =>
    Ok(current.configuration.underlying.getConfig("features").resolve.root.render(ConfigRenderOptions.concise()))
  }

}


object ReleaseInformationDAO extends SimpleSQLDAO with FoxImplicits {
  def getSchemaVersion = {
    for {
      rList <- run(sql"select schemaVersion from webknossos.releaseInformation".as[Int])
      r <- rList.headOption.toFox
    } yield r
  }
}
