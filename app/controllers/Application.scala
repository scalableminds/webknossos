package controllers

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.config.ConfigRenderOptions
import mail.{DefaultMails, Send}
import models.organization.OrganizationDAO
import models.user.UserService
import org.apache.pekko.actor.ActorSystem
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, Result}
import play.silhouette.api.Silhouette
import security.{CertificateValidationService, WkEnv}
import utils.sql.{SimpleSQLDAO, SqlClient}
import utils.{BuildInfoService, WkConf}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class Application @Inject()(actorSystem: ActorSystem,
                            userService: UserService,
                            buildInfoService: BuildInfoService,
                            organizationDAO: OrganizationDAO,
                            conf: WkConf,
                            defaultMails: DefaultMails,
                            sil: Silhouette[WkEnv],
                            certificateValidationService: CertificateValidationService)(implicit ec: ExecutionContext)
    extends Controller {

  private lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  // Note: This route is used by external applications, keep stable
  def buildInfo: Action[AnyContent] = sil.UserAwareAction.async {
    for {
      buildInfoJson <- buildInfoService.buildInfoJson
    } yield addRemoteOriginHeaders(Ok(buildInfoJson))
  }

  // This only changes on server restart, so we can cache the full result.
  private lazy val cachedFeaturesResult: Result = addNoCacheHeaderFallback(
    Ok(conf.raw.underlying.getConfig("features").resolve.root.render(ConfigRenderOptions.concise())).as(jsonMimeType))

  def features: Action[AnyContent] = sil.UserAwareAction {
    cachedFeaturesResult
  }

  def health: Action[AnyContent] = Action {
    addNoCacheHeaderFallback(Ok("Ok"))
  }

  def checkCertificate: Action[AnyContent] = Action.async { implicit request =>
    certificateValidationService.checkCertificateCached().map {
      case (true, expiresAt)  => Ok(Json.obj("isValid" -> true, "expiresAt" -> expiresAt))
      case (false, expiresAt) => BadRequest(Json.obj("isValid" -> false, "expiresAt" -> expiresAt))
    }
  }

  def helpEmail(message: String, currentUrl: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      userEmail <- userService.emailFor(request.identity)
      _ = Mailer ! Send(defaultMails.helpMail(request.identity, userEmail, organization.name, message, currentUrl))
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
      rList <- run(q"SELECT schemaVersion FROM webknossos.releaseInformation".as[Int])
      r <- rList.headOption.toFox
    } yield r
}
