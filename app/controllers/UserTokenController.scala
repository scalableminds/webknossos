package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.AccessMode.AccessMode
import com.scalableminds.webknossos.datastore.services.{
  AccessMode,
  AccessResourceType,
  UserAccessAnswer,
  UserAccessRequest
}
import javax.inject.Inject
import models.annotation._
import models.binary.{DataSetDAO, DataSetService, DataStoreRpcClient, DataStoreService}
import models.user.{User, UserService}
import net.liftweb.common.{Box, Full}
import oxalis.security._
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, Result}
import utils.WkConf

import scala.concurrent.ExecutionContext

class UserTokenController @Inject()(dataSetDAO: DataSetDAO,
                                    dataSetService: DataSetService,
                                    annotationDAO: AnnotationDAO,
                                    userService: UserService,
                                    annotationStore: AnnotationStore,
                                    annotationInformationProvider: AnnotationInformationProvider,
                                    dataStoreService: DataStoreService,
                                    tracingStoreService: TracingStoreService,
                                    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                    conf: WkConf,
                                    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  private val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def generateTokenForDataStore: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
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

  def validateAccessViaDatastore(name: String, token: Option[String]): Action[UserAccessRequest] =
    Action.async(validateJson[UserAccessRequest]) { implicit request =>
      dataStoreService.validateAccess(name) { _ =>
        validateUserAccess(request.body, token)
      }
    }

  def validateAccessViaTracingstore(name: String, token: Option[String]): Action[UserAccessRequest] =
    Action.async(validateJson[UserAccessRequest]) { implicit request =>
      tracingStoreService.validateAccess(name) { _ =>
        validateUserAccess(request.body, token)
      }
    }

  /* token may be
       - the global webKnossosToken (allow everything)
       - a user token (allow what that user may do)
       - a dataset sharing token (allow seeing dataset / annotations that token belongs to)
   */
  private def validateUserAccess(accessRequest: UserAccessRequest, token: Option[String])(
      implicit ec: ExecutionContext): Fox[Result] =
    if (token.contains(DataStoreRpcClient.webKnossosToken)) {
      Fox.successful(Ok(Json.toJson(UserAccessAnswer(granted = true))))
    } else {
      for {
        userBox <- bearerTokenService.userForTokenOpt(token)(GlobalAccessContext).futureBox
        sharingTokenAccessCtx = URLSharing.fallbackTokenAccessContext(token)(DBAccessContext(userBox))
        answer <- accessRequest.resourceType match {
          case AccessResourceType.datasource =>
            handleDataSourceAccess(accessRequest.resourceId, accessRequest.mode, userBox)(sharingTokenAccessCtx)
          case AccessResourceType.tracing =>
            handleTracingAccess(accessRequest.resourceId.name, accessRequest.mode, userBox)
          case _ =>
            Fox.successful(UserAccessAnswer(granted = false, Some("Invalid access token.")))
        }
      } yield {
        Ok(Json.toJson(answer))
      }
    }

  private def handleDataSourceAccess(dataSourceId: DataSourceId, mode: AccessMode, userBox: Box[User])(
      implicit ctx: DBAccessContext): Fox[UserAccessAnswer] = {
    // Write access is explicitly handled here depending on userBox,
    // Read access is ensured in findOneBySourceName, depending on the implicit DBAccessContext (to allow sharingTokens)

    def tryRead: Fox[UserAccessAnswer] =
      for {
        dataSourceBox <- dataSetDAO.findOneByNameAndOrganizationName(dataSourceId.name, dataSourceId.team).futureBox
      } yield
        dataSourceBox match {
          case Full(_) => UserAccessAnswer(granted = true)
          case _       => UserAccessAnswer(granted = false, Some("No read access on dataset"))
        }

    def tryWrite: Fox[UserAccessAnswer] =
      for {
        dataset <- dataSetDAO.findOneByNameAndOrganizationName(dataSourceId.name, dataSourceId.team) ?~> "datasource.notFound"
        user <- userBox.toFox ?~> "auth.token.noUser"
        isAllowed <- dataSetService.isEditableBy(dataset, Some(user))
      } yield {
        UserAccessAnswer(isAllowed)
      }

    def tryAdministrate: Fox[UserAccessAnswer] =
      userBox match {
        case Full(user) =>
          for {
            isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(user, user._organization)
          } yield UserAccessAnswer(isTeamManagerOrAdmin || user.isDatasetManager)
        case _ => Fox.successful(UserAccessAnswer(granted = false, Some("invalid access token")))
      }

    def tryDelete: Fox[UserAccessAnswer] =
      for {
        _ <- bool2Fox(conf.Features.allowDeleteDatasets) ?~> "dataset.delete.disabled"
        dataset <- dataSetDAO.findOneByNameAndOrganizationName(dataSourceId.name, dataSourceId.team)(
          GlobalAccessContext) ?~> "datasource.notFound"
        user <- userBox.toFox ?~> "auth.token.noUser"
      } yield UserAccessAnswer(user._organization == dataset._organization && user.isAdmin)

    mode match {
      case AccessMode.read         => tryRead
      case AccessMode.write        => tryWrite
      case AccessMode.administrate => tryAdministrate
      case AccessMode.delete       => tryDelete
      case _                       => Fox.successful(UserAccessAnswer(granted = false, Some("invalid access token")))
    }
  }

  private def handleTracingAccess(tracingId: String, mode: AccessMode, userBox: Box[User]): Fox[UserAccessAnswer] = {
    // Access is explicitly checked by userBox, not by DBAccessContext, as there is no token sharing for annotations

    def findAnnotationForTracing(tracingId: String)(implicit ctx: DBAccessContext): Fox[Annotation] = {
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
      annotation <- findAnnotationForTracing(tracingId)(GlobalAccessContext) ?~> "annotation.notFound"
      restrictions <- annotationInformationProvider.restrictionsFor(
        AnnotationIdentifier(annotation.typ, annotation._id))(GlobalAccessContext) ?~> "restrictions.notFound"
      allowed <- checkRestrictions(restrictions) ?~> "restrictions.failedToCheck"
    } yield {
      if (allowed) UserAccessAnswer(granted = true)
      else UserAccessAnswer(granted = false, Some(s"No ${mode.toString} access to tracing"))
    }
  }
}
