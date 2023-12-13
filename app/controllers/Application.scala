package controllers

import akka.actor.ActorSystem
import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.config.ConfigRenderOptions
import mail.{DefaultMails, Send}
import models.analytics.{AnalyticsService, FrontendAnalyticsEvent}
import models.organization.OrganizationDAO
import models.user.UserService
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.WkEnv
import utils.sql.{SimpleSQLDAO, SqlClient}
import utils.{StoreModules, WkConf}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class Application @Inject()(actorSystem: ActorSystem,
                            analyticsService: AnalyticsService,
                            userService: UserService,
                            releaseInformationDAO: ReleaseInformationDAO,
                            organizationDAO: OrganizationDAO,
                            conf: WkConf,
                            defaultMails: DefaultMails,
                            storeModules: StoreModules,
                            sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  private lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  def buildInfo: Action[AnyContent] = sil.UserAwareAction.async {
    for {
      schemaVersion <- releaseInformationDAO.getSchemaVersion.futureBox
    } yield {
      addRemoteOriginHeaders(
        Ok(
          Json.obj(
            "webknossos" -> Json.toJson(webknossos.BuildInfo.toMap.view.mapValues(_.toString).toMap),
            "webknossos-wrap" -> Json.toJson(webknossoswrap.BuildInfo.toMap.view.mapValues(_.toString).toMap),
            "schemaVersion" -> schemaVersion.toOption,
            "localDataStoreEnabled" -> storeModules.localDataStoreEnabled,
            "localTracingStoreEnabled" -> storeModules.localTracingStoreEnabled
          ))
      )
    }
  }

  def trackAnalyticsEvent(eventType: String): Action[JsObject] = sil.UserAwareAction(validateJson[JsObject]) {
    implicit request =>
      request.identity.foreach { user =>
        analyticsService.track(FrontendAnalyticsEvent(user, eventType, request.body))
      }
      Ok
  }

  def features: Action[AnyContent] = sil.UserAwareAction {
    addNoCacheHeaderFallback(
      Ok(conf.raw.underlying.getConfig("features").resolve.root.render(ConfigRenderOptions.concise())).as(jsonMimeType))
  }

  def health: Action[AnyContent] = Action {
    addNoCacheHeaderFallback(Ok("Ok"))
  }

  def helpEmail(message: String, currentUrl: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      userEmail <- userService.emailFor(request.identity)
      _ = Mailer ! Send(
        defaultMails.helpMail(request.identity, userEmail, organization.displayName, message, currentUrl))
    } yield Ok
  }

  def getSecurityTxt: Action[AnyContent] = Action {
    addNoCacheHeaderFallback(if (conf.WebKnossos.SecurityTxt.enabled) {
      Ok(conf.WebKnossos.SecurityTxt.content)
    } else {
      NotFound
    })
  }

}

class ReleaseInformationDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient)
    with FoxImplicits {
  def getSchemaVersion(implicit ec: ExecutionContext): Fox[Int] =
    for {
      rList <- run(q"select schemaVersion from webknossos.releaseInformation".as[Int])
      r <- rList.headOption.toFox
    } yield r
}
