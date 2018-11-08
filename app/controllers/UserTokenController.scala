package controllers

import com.mohiva.play.silhouette.api.Silhouette
import javax.inject.Inject

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.{
  AccessMode,
  AccessResourceType,
  UserAccessAnswer,
  UserAccessRequest
}
import models.annotation._
import models.binary.{DataSetDAO, DataStoreRpcClient, DataStoreService}
import models.user.{User, UserService}
import net.liftweb.common.{Box, Full}
import oxalis.security._
import play.api.libs.json.Json
import play.api.mvc.{PlayBodyParsers, Result}

import scala.concurrent.ExecutionContext

class UserTokenController @Inject()(dataSetDAO: DataSetDAO,
                                    annotationDAO: AnnotationDAO,
                                    userService: UserService,
                                    annotationStore: AnnotationStore,
                                    annotationInformationProvider: AnnotationInformationProvider,
                                    dataStoreService: DataStoreService,
                                    tracingStoreService: TracingStoreService,
                                    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def generateTokenForDataStore = sil.UserAwareAction.async { implicit request =>
    val context = userAwareRequestToDBAccess(request)
    val tokenFox: Fox[String] = request.identity match {
      case Some(user) =>
        bearerTokenService.createAndInit(user.loginInfo, TokenType.DataStore, deleteOld = false).toFox
      case None => Fox.successful("")
    }
    for {
      token <- tokenFox
    } yield {
      Ok(Json.obj("token" -> token))
    }
  }

  def validateAccessViaDatastore(name: String, token: String) = Action.async(validateJson[UserAccessRequest]) {
    implicit request =>
      dataStoreService.validateAccess(name) { dataStore =>
        validateUserAccess(request.body, token)
      }
  }

  def validateAccessViaTracingstore(name: String, token: String) = Action.async(validateJson[UserAccessRequest]) {
    implicit request =>
      tracingStoreService.validateAccess(name) { tracingStore =>
        validateUserAccess(request.body, token)
      }
  }

  private def validateUserAccess(accessRequest: UserAccessRequest, token: String)(
      implicit ec: ExecutionContext): Fox[Result] =
    if (token == DataStoreRpcClient.webKnossosToken) {
      Fox.successful(Ok(Json.toJson(UserAccessAnswer(true))))
    } else {
      for {
        userBox <- bearerTokenService.userForToken(token)(GlobalAccessContext).futureBox
        ctxFromUserBox = DBAccessContext(userBox)
        ctx = URLSharing.fallbackTokenAccessContext(Some(token))(ctxFromUserBox)
        answer <- accessRequest.resourceType match {
          case AccessResourceType.datasource =>
            handleDataSourceAccess(accessRequest.resourceId, accessRequest.mode, userBox)(ctx)
          case AccessResourceType.tracing =>
            handleTracingAccess(accessRequest.resourceId.name, accessRequest.mode, userBox)(ctx)
          case _ =>
            Fox.successful(UserAccessAnswer(false, Some("Invalid access token.")))
        }
      } yield {
        Ok(Json.toJson(answer))
      }
    }

  private def handleDataSourceAccess(dataSourceId: DataSourceId, mode: AccessMode.Value, userBox: Box[User])(
      implicit ctx: DBAccessContext): Fox[UserAccessAnswer] = {
    //Note: reading access is ensured in findOneBySourceName, depending on the implicit DBAccessContext

    def tryRead: Fox[UserAccessAnswer] =
      for {
        dataSourceBox <- dataSetDAO.findOneByNameAndOrganizationName(dataSourceId.name, dataSourceId.team).futureBox
      } yield
        dataSourceBox match {
          case Full(_) => UserAccessAnswer(true)
          case _       => UserAccessAnswer(false, Some("No read access on dataset"))
        }

    def tryWrite: Fox[UserAccessAnswer] =
      for {
        dataset <- dataSetDAO.findOneByNameAndOrganizationName(dataSourceId.name, dataSourceId.team) ?~> "datasource.notFound"
        user <- userBox.toFox
        isAllowed <- userService.isTeamManagerOrAdminOfOrg(user, dataset._organization)
      } yield {
        UserAccessAnswer(isAllowed)
      }

    def tryAdministrate: Fox[UserAccessAnswer] =
      userBox match {
        case Full(user) =>
          for {
            isAllowed <- userService.isTeamManagerOrAdminOfOrg(user, user._organization)
          } yield UserAccessAnswer(isAllowed)
        case _ => Fox.successful(UserAccessAnswer(false, Some("invalid access token")))
      }

    mode match {
      case AccessMode.read         => tryRead
      case AccessMode.write        => tryWrite
      case AccessMode.administrate => tryAdministrate
      case _                       => Fox.successful(UserAccessAnswer(false, Some("invalid access token")))
    }
  }

  private def handleTracingAccess(tracingId: String, mode: AccessMode.Value, userBox: Box[User])(
      implicit ctx: DBAccessContext): Fox[UserAccessAnswer] = {

    def findAnnotationForTracing(tracingId: String): Fox[Annotation] = {
      val annotationFox = annotationDAO.findOneByTracingId(tracingId)
      for {
        annotationBox <- annotationFox.futureBox
      } yield {
        annotationBox match {
          case Full(_) => annotationBox
          case _       => annotationStore.findCachedByTracingId(tracingId)
        }
      }
    }

    def checkRestrictions(restrictions: AnnotationRestrictions) =
      mode match {
        case AccessMode.read  => restrictions.allowAccess(userBox)
        case AccessMode.write => restrictions.allowUpdate(userBox)
        case _                => Fox.successful(false)
      }

    for {
      annotation <- findAnnotationForTracing(tracingId)
      restrictions <- annotationInformationProvider.restrictionsFor(
        AnnotationIdentifier(annotation.typ, annotation._id))
      allowed <- checkRestrictions(restrictions)
    } yield {
      if (allowed) UserAccessAnswer(true) else UserAccessAnswer(false, Some(s"No ${mode.toString} access to tracing"))
    }
  }
}
