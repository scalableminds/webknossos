package controllers

import akka.actor.ActorSystem
import io.github.honeycombcheesecake.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.config.ConfigRenderOptions
import io.swagger.annotations.{Api, ApiOperation, ApiResponse, ApiResponses}
import mail.{DefaultMails, Send}
import models.analytics.{AnalyticsService, FrontendAnalyticsEvent}
import models.organization.OrganizationDAO
import models.user.{MultiUserDAO, UserService}
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.WkEnv
import utils.sql.{SimpleSQLDAO, SqlClient}
import utils.{StoreModules, WkConf}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

@Api
class Application @Inject()(multiUserDAO: MultiUserDAO,
                            actorSystem: ActorSystem,
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

  @ApiOperation(value = "Information about the version of WEBKNOSSOS")
  @ApiResponses(
    Array(
      new ApiResponse(code = 200, message = "JSON object containing information about the version of WEBKNOSSOS"),
      new ApiResponse(code = 400, message = "Operation could not be performed. See JSON body for more information.")
    ))
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

  @ApiOperation(hidden = true, value = "")
  def trackAnalyticsEvent(eventType: String): Action[JsObject] = sil.UserAwareAction(validateJson[JsObject]) {
    implicit request =>
      request.identity.foreach { user =>
        analyticsService.track(FrontendAnalyticsEvent(user, eventType, request.body))
      }
      Ok
  }

  @ApiOperation(hidden = true, value = "")
  def features: Action[AnyContent] = sil.UserAwareAction {
    addNoCacheHeaderFallback(
      Ok(conf.raw.underlying.getConfig("features").resolve.root.render(ConfigRenderOptions.concise())))
  }

  @ApiOperation(value = "Health endpoint")
  def health: Action[AnyContent] = Action {
    addNoCacheHeaderFallback(Ok("Ok"))
  }

  @ApiOperation(hidden = true, value = "")
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
