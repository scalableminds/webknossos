package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.services.AccessMode.AccessMode
import com.scalableminds.webknossos.datastore.services.{
  AccessMode,
  AccessResourceType,
  UserAccessAnswer,
  UserAccessRequest
}
import com.scalableminds.webknossos.tracingstore.tracings.TracingId
import models.annotation._
import models.dataset.{DataStoreService, DatasetDAO, DatasetService}
import models.job.JobDAO
import models.user.{User, UserService}
import com.scalableminds.util.tools.{Box, Full}
import play.api.i18n.MessagesProvider
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, Result}
import play.silhouette.api.Silhouette
import security.{RandomIDGenerator, URLSharing, WkEnv, WkSilhouetteEnvironment}
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

object RpcTokenHolder {
  /*
   * This token is used to tell the datastore or tracing store “I am WEBKNOSSOS”.
   * The respective module asks the remote WEBKNOSSOS to validate that.
   * The token is refreshed on every wK restart.
   * Keep it secret!
   */
  lazy val webknossosToken: String = RandomIDGenerator.generateBlocking()
}

class UserTokenController @Inject()(datasetDAO: DatasetDAO,
                                    datasetService: DatasetService,
                                    annotationPrivateLinkDAO: AnnotationPrivateLinkDAO,
                                    userService: UserService,
                                    annotationInformationProvider: AnnotationInformationProvider,
                                    annotationStore: AnnotationStore,
                                    dataStoreService: DataStoreService,
                                    tracingStoreService: TracingStoreService,
                                    jobDAO: JobDAO,
                                    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                    conf: WkConf,
                                    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  private val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  // Generates a token that can be used for requests to a datastore. The token is valid for 1 day by default
  def generateTokenForDataStore: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    val tokenFox: Fox[String] = request.identity match {
      case Some(user) =>
        bearerTokenService.createAndInitDataStoreTokenForUser(user)
      case None => Fox.successful("")
    }
    for {
      token <- tokenFox
    } yield Ok(Json.obj("token" -> token))
  }

  def validateAccessViaDatastore(name: String, key: String, token: Option[String]): Action[UserAccessRequest] =
    Action.async(validateJson[UserAccessRequest]) { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        validateUserAccess(request.body, token)
      }
    }

  def validateAccessViaTracingstore(name: String, key: String, token: Option[String]): Action[UserAccessRequest] =
    Action.async(validateJson[UserAccessRequest]) { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        validateUserAccess(request.body, token)
      }
    }

  /* token may be
       - the global webknossosToken (allow everything)
       - a user token (allow what that user may do)
       - a dataset sharing token (allow seeing dataset / annotations that token belongs to)
   */
  private def validateUserAccess(accessRequest: UserAccessRequest, token: Option[String])(
      implicit ec: ExecutionContext,
      mp: MessagesProvider): Fox[Result] =
    if (token.contains(RpcTokenHolder.webknossosToken)) {
      Fox.successful(Ok(Json.toJson(UserAccessAnswer(granted = true))))
    } else {
      for {
        userBox <- bearerTokenService.userForTokenOpt(token).shiftBox
        sharingTokenAccessCtx = URLSharing.fallbackTokenAccessContext(token)(DBAccessContext(userBox.toOption))
        answer <- accessRequest.resourceType match {
          case AccessResourceType.dataset =>
            handleDataSetAccess(accessRequest.resourceId, accessRequest.mode, userBox)(sharingTokenAccessCtx)
          case AccessResourceType.tracing =>
            handleTracingAccess(accessRequest.resourceId, accessRequest.mode, userBox, token)
          case AccessResourceType.annotation =>
            handleAnnotationAccess(accessRequest.resourceId, accessRequest.mode, userBox, token)
          case AccessResourceType.jobExport =>
            handleJobExportAccess(accessRequest.resourceId, accessRequest.mode, userBox)
          case _ =>
            Fox.successful(UserAccessAnswer(granted = false, Some("Invalid access token.")))
        }
      } yield Ok(Json.toJson(answer))
    }

  private def handleDataSetAccess(idOpt: Option[String], mode: AccessMode.Value, userBox: Box[User])(
      implicit ctx: DBAccessContext): Fox[UserAccessAnswer] = {

    def tryRead: Fox[UserAccessAnswer] =
      for {
        idStr <- idOpt.toFox
        datasetId <- ObjectId.fromString(idStr)
        datasetBox <- datasetDAO.findOne(datasetId).shiftBox
      } yield
        datasetBox match {
          case Full(_) => UserAccessAnswer(granted = true)
          case _       => UserAccessAnswer(granted = false, Some("No read access on dataset"))
        }

    def tryWrite: Fox[UserAccessAnswer] =
      for {
        idStr <- idOpt.toFox
        datasetId <- ObjectId.fromString(idStr)
        dataset <- datasetDAO.findOne(datasetId)(GlobalAccessContext) ?~> "dataset.notFound"
        user <- userBox.toFox ?~> "auth.token.noUser"
        isAllowed <- datasetService.isEditableBy(dataset, Some(user))
      } yield UserAccessAnswer(isAllowed)

    def tryDelete: Fox[UserAccessAnswer] =
      for {
        _ <- Fox.fromBool(conf.Features.allowDeleteDatasets) ?~> "dataset.delete.disabled"
        idStr <- idOpt.toFox
        datasetId <- ObjectId.fromString(idStr)
        dataset <- datasetDAO.findOne(datasetId)(GlobalAccessContext) ?~> "dataset.notFound"
        user <- userBox.toFox ?~> "auth.token.noUser"
      } yield UserAccessAnswer(user._organization == dataset._organization && user.isAdmin)

    def tryAdministrate: Fox[UserAccessAnswer] =
      userBox match {
        case Full(user) =>
          for {
            isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(user, idOpt.getOrElse(user._organization))
          } yield UserAccessAnswer(isTeamManagerOrAdmin || user.isDatasetManager)
        case _ => Fox.successful(UserAccessAnswer(granted = false, Some("invalid access token")))
      }

    mode match {
      case AccessMode.read         => tryRead
      case AccessMode.write        => tryWrite
      case AccessMode.delete       => tryDelete
      case AccessMode.administrate => tryAdministrate
      case _                       => Fox.successful(UserAccessAnswer(granted = false, Some("invalid access token")))
    }
  }

  private def handleTracingAccess(tracingIdOpt: Option[String],
                                  mode: AccessMode,
                                  userBox: Box[User],
                                  token: Option[String])(implicit mp: MessagesProvider): Fox[UserAccessAnswer] =
    if (tracingIdOpt.contains(TracingId.dummy))
      Fox.successful(UserAccessAnswer(granted = true))
    else
      for {
        tracingId <- tracingIdOpt.toFox
        annotation <- annotationInformationProvider.annotationForTracing(tracingId)(GlobalAccessContext) ?~> "annotation.notFound"
        result <- handleAnnotationAccess(Some(annotation._id.toString), mode, userBox, token)
      } yield result

  private def handleAnnotationAccess(annotationIdOpt: Option[String],
                                     mode: AccessMode,
                                     userBox: Box[User],
                                     token: Option[String])(implicit mp: MessagesProvider): Fox[UserAccessAnswer] = {
    // Access is explicitly checked by userBox, not by DBAccessContext, as there is no token sharing for annotations
    // Optionally, an accessToken can be provided which explicitly looks up the read right the private link table

    def checkRestrictions(restrictions: AnnotationRestrictions) =
      mode match {
        case AccessMode.read  => restrictions.allowAccess(userBox.toOption)
        case AccessMode.write => restrictions.allowUpdate(userBox.toOption)
        case _                => Fox.successful(false)
      }

    if (annotationIdOpt.contains(ObjectId.dummyId.toString)) {
      Fox.successful(UserAccessAnswer(granted = true))
    } else {
      for {
        annotationIdStr <- annotationIdOpt.toFox
        annotationId <- ObjectId.fromString(annotationIdStr)
        annotationBox <- annotationInformationProvider
          .provideAnnotation(annotationId, userBox.toOption)(GlobalAccessContext, mp)
          .shiftBox
        annotation <- annotationBox match {
          case Full(_) => annotationBox.toFox
          case _       => annotationStore.findInCache(annotationId).toFox
        }
        annotationAccessByToken <- token
          .map(annotationPrivateLinkDAO.findOneByAccessToken)
          .getOrElse(Fox.empty)
          .shiftBox
        allowedByToken = annotationAccessByToken.exists(annotation._id == _._annotation)
        restrictions <- annotationInformationProvider.restrictionsFor(
          AnnotationIdentifier(annotation.typ, annotation._id))(GlobalAccessContext) ?~> "restrictions.notFound"
        allowedByUser <- checkRestrictions(restrictions) ?~> "restrictions.failedToCheck"
        allowed = allowedByToken || allowedByUser
      } yield {
        if (allowed) UserAccessAnswer(granted = true)
        else UserAccessAnswer(granted = false, Some(s"No ${mode.toString} access to tracing"))
      }
    }
  }

  private def handleJobExportAccess(jobIdOpt: Option[String],
                                    mode: AccessMode,
                                    userBox: Box[User]): Fox[UserAccessAnswer] =
    if (mode != AccessMode.read)
      Fox.successful(UserAccessAnswer(granted = false, Some(s"Unsupported access mode for job exports: $mode")))
    else {
      for {
        jobIdStr <- jobIdOpt.toFox
        jobId <- ObjectId.fromString(jobIdStr)
        jobBox <- jobDAO.findOne(jobId)(DBAccessContext(userBox.toOption)).shiftBox
        answer = jobBox match {
          case Full(_) => UserAccessAnswer(granted = true)
          case _       => UserAccessAnswer(granted = false, Some(s"No $mode access to job export"))
        }
      } yield answer
    }

}
