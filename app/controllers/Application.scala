package controllers

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.{NativeAdder, NativeArrayAdder, NativeDracoToStlConverter}
import com.typesafe.config.ConfigRenderOptions
import mail.{DefaultMails, Send}
import models.organization.OrganizationDAO
import models.user.UserService
import org.apache.pekko.actor.ActorSystem
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}
import play.silhouette.api.Silhouette
import security.WkEnv
import utils.sql.{SimpleSQLDAO, SqlClient}
import utils.{ApiVersioning, StoreModules, WkConf}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class Application @Inject()(actorSystem: ActorSystem,
                            userService: UserService,
                            releaseInformationDAO: ReleaseInformationDAO,
                            organizationDAO: OrganizationDAO,
                            conf: WkConf,
                            defaultMails: DefaultMails,
                            storeModules: StoreModules,
                            sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with ApiVersioning {

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
            "schemaVersion" -> schemaVersion.toOption,
            "httpApiVersioning" -> Json.obj(
              "currentApiVersion" -> CURRENT_API_VERSION,
              "oldestSupportedApiVersion" -> OLDEST_SUPPORTED_API_VERSION
            ),
            "localDataStoreEnabled" -> storeModules.localDataStoreEnabled,
            "localTracingStoreEnabled" -> storeModules.localTracingStoreEnabled
          ))
      )
    }
  }

  def features: Action[AnyContent] = sil.UserAwareAction {
    addNoCacheHeaderFallback(
      Ok(conf.raw.underlying.getConfig("features").resolve.root.render(ConfigRenderOptions.concise())).as(jsonMimeType))
  }

  def health: Action[AnyContent] = Action {
    addNoCacheHeaderFallback(Ok("Ok"))
  }

  def testAdd(a: Int, b: Int): Action[AnyContent] = sil.UserAwareAction {
    val sum = new NativeAdder().add(a, b)
    val sumArray = new NativeArrayAdder().add(Array[Byte](1, 2, 3, 4));
    Ok(Json.obj("sum" -> sum, "sumArray" -> sumArray.mkString("")))
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
