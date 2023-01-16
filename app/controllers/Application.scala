package controllers

import akka.actor.ActorSystem
import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.config.ConfigRenderOptions
import io.swagger.annotations.{Api, ApiOperation, ApiResponse, ApiResponses}
import models.analytics.{AnalyticsService, FrontendAnalyticsEvent}
import models.organization.OrganizationDAO
import models.user.{MultiUserDAO, UserService}
import oxalis.mail.{DefaultMails, Send}
import oxalis.security.WkEnv
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
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

  @ApiOperation(value = "Information about the version of webKnossos")
  @ApiResponses(
    Array(
      new ApiResponse(code = 200, message = "JSON object containing information about the version of webKnossos"),
      new ApiResponse(code = 400, message = "Operation could not be performed. See JSON body for more information.")
    ))
  def buildInfo: Action[AnyContent] = sil.UserAwareAction.async {
    for {
      schemaVersion <- releaseInformationDAO.getSchemaVersion.futureBox
    } yield {
      addRemoteOriginHeaders(
        Ok(Json.obj(
          "webknossos" -> webknossos.BuildInfo.toMap.mapValues(_.toString),
          "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString),
          "schemaVersion" -> schemaVersion.toOption,
          "localDataStoreEnabled" -> storeModules.localDataStoreEnabled,
          "localTracingStoreEnabled" -> storeModules.localTracingStoreEnabled
        )))
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
    Ok(conf.raw.underlying.getConfig("features").resolve.root.render(ConfigRenderOptions.concise()))
  }

  @ApiOperation(value = "Health endpoint")
  def health: Action[AnyContent] = Action {
    Ok
  }

  @ApiOperation(hidden = true, value = "")
  def helpEmail(message: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      userEmail <- userService.emailFor(request.identity)
      _ = Mailer ! Send(defaultMails.helpMail(request.identity, userEmail, organization.displayName, message))
    } yield Ok
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
