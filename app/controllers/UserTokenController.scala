package controllers

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.services.AccessMode.AccessMode
import com.scalableminds.webknossos.datastore.services.{
  AccessMode,
  AccessResourceType,
  UserAccessAnswer,
  UserAccessRequest
}
import com.scalableminds.webknossos.tracingstore.tracings.TracingId
import models.alignmentproject.{AlignmentProjectDAO, AlignmentProjectStatus}
import models.annotation.*
import models.dataset.{DataStoreService, DatasetDAO, DatasetService}
import models.job.JobDAO
import models.user.{User, UserService}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, Result}
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.UserAwareRequest
import play.silhouette.impl.authenticators.BearerTokenAuthenticator
import security.{
  RandomIDGenerator,
  Scope,
  ScopeMode,
  ScopeSet,
  ScopedApiTokenService,
  URLSharing,
  WkEnv,
  WkSilhouetteEnvironment
}
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

class UserTokenController @Inject() (
    datasetDAO: DatasetDAO,
    datasetService: DatasetService,
    annotationPrivateLinkDAO: AnnotationPrivateLinkDAO,
    userService: UserService,
    annotationInformationProvider: AnnotationInformationProvider,
    annotationStore: AnnotationStore,
    dataStoreService: DataStoreService,
    tracingStoreService: TracingStoreService,
    jobDAO: JobDAO,
    alignmentProjectDAO: AlignmentProjectDAO,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
    scopedApiTokenService: ScopedApiTokenService,
    conf: WkConf,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  private val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  // Generates a token that can be used for requests to a datastore. The token is valid for 1 day by default
  def generateTokenForDataStore: Action[AnyContent] = sil.UserAwareAction.fox { implicit request =>
    val tokenFox: Fox[String] = request.identity match {
      case Some(user) =>
        scopedApiTokenOf(request) match {
          // If the request is by a scopedApiToken, this will also yield a scopedApiToken so permissions stay scoped.
          // The datastore accepts those too.
          case Some(scopedApiTokenValue) =>
            for {
              scopedApiToken <- scopedApiTokenService.findValid(scopedApiTokenValue) ?~> "Invalid token"
              newToken <- scopedApiTokenService.createFrom(
                scopedApiToken,
                conf.Silhouette.TokenAuthenticator.scopedApiTokenExpiry
              )
            } yield newToken.value
          case None => bearerTokenService.createAndInitDataStoreTokenForUser(user)
        }
      case None => Fox.successful("")
    }
    for {
      token <- tokenFox
    } yield Ok(Json.obj("token" -> token))
  }

  def validateAccessViaDatastore(name: String, key: String, token: Option[String]): Action[UserAccessRequest] =
    Action.fox(validateJson[UserAccessRequest]) { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        validateUserAccess(request.body, token)
      }
    }

  def validateAccessViaTracingstore(name: String, key: String, token: Option[String]): Action[UserAccessRequest] =
    Action.fox(validateJson[UserAccessRequest]) { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        validateUserAccess(request.body, token)
      }
    }

  /* token may be
       - the global webknossosToken (allow everything)
       - a user token (allow what that user may do)
       - a dataset sharing token (allow seeing dataset / annotations that token belongs to)
       - A scoped access token (allow what that user may do *and* is allowed by the token’s scope)
   */
  private def validateUserAccess(accessRequest: UserAccessRequest, token: Option[String])(implicit
      ec: ExecutionContext
  ): Fox[Result] =
    if (token.contains(RpcTokenHolder.webknossosToken)) {
      Fox.successful(Ok(Json.toJson(UserAccessAnswer(granted = true))))
    } else {
      for {
        scopeCheck <- checkScopes(token, accessRequest)
        scopeDenial = denialFor(scopeCheck, accessRequest)
        userBox <- bearerTokenService.userForTokenOpt(token).shiftBox
        sharingTokenAccessCtx = URLSharing.fallbackTokenAccessContext(token)(using DBAccessContext(userBox.toOption))
        answer <-
          if (scopeDenial.isDefined) Fox.successful(UserAccessAnswer(granted = false, scopeDenial))
          else
            accessRequest.resourceType match {
              case AccessResourceType.dataset =>
                handleDataSetAccess(accessRequest.resourceId, accessRequest.mode, userBox)(using sharingTokenAccessCtx)
              case AccessResourceType.tracing =>
                handleTracingAccess(accessRequest.resourceId, accessRequest.mode, userBox, token)
              case AccessResourceType.annotation =>
                handleAnnotationAccess(accessRequest.resourceId, accessRequest.mode, userBox, token)
              case AccessResourceType.jobExport =>
                handleJobExportAccess(accessRequest.resourceId, accessRequest.mode, userBox)
              case AccessResourceType.alignmentProject =>
                handleAlignmentProjectAccess(accessRequest.resourceId, accessRequest.mode, userBox)
              case _ =>
                Fox.successful(UserAccessAnswer(granted = false, Some("Invalid access token.")))
            }
      } yield Ok(Json.toJson(answer.copy(userId = userBox.toOption.map(_._id))))
    }

  // The authenticator has already been validated at this point, so recognizing the token type is enough.
  private def scopedApiTokenOf(request: UserAwareRequest[WkEnv, ?]): Option[String] =
    request.authenticator.map(_.actualAuthenticator).collect {
      case a: BearerTokenAuthenticator if scopedApiTokenService.looksLikeScopedApiTokenValue(a.id) => a.id
    }

  private enum ScopeCheck {
    case Allowed
    // A value that looks like a scoped API token but is not a valid one (expired, revoked, or its grant revoked).
    case InvalidToken
    case MissingScope(scopes: ScopeSet)
  }

  /*
   * Datastore/Tracingstore access using scoped tokens must also be checked against their scopes.
   * On pure WK side this is handled by filters.ScopeFilter.
   */
  private def checkScopes(token: Option[String], accessRequest: UserAccessRequest)(implicit
      ec: ExecutionContext
  ): Fox[ScopeCheck] =
    token match {
      case None             => Fox.successful(ScopeCheck.Allowed) // Not a scoped token, no scope restrictions.
      case Some(tokenValue) =>
        scopedApiTokenService.findValid(tokenValue).shiftBox.flatMap {
          // The scopes are read from the grant per request, so that changing them takes effect at once.
          case Full(scopedApiToken) =>
            val allowed = Scope.fromAccessResourceType(accessRequest.resourceType).exists { resource =>
              scopedApiToken.scopes.allows(Scope(resource, ScopeMode.fromAccessMode(accessRequest.mode)))
            }
            Fox.successful(if (allowed) ScopeCheck.Allowed else ScopeCheck.MissingScope(scopedApiToken.scopes))
          case Empty =>
            Fox.successful(
              if (scopedApiTokenService.looksLikeScopedApiTokenValue(tokenValue)) ScopeCheck.InvalidToken
              else ScopeCheck.Allowed
            )
          case failure: Failure => failure.toFox
        }
    }

  // Like filters.ScopeFilter: invalid scoped tokens are always denied, missing scopes only if enforcement is on.
  private def denialFor(scopeCheck: ScopeCheck, accessRequest: UserAccessRequest): Option[String] = {
    def describe =
      s"${accessRequest.mode} access to ${accessRequest.resourceType} ${accessRequest.resourceId.getOrElse("")}"
    scopeCheck match {
      case ScopeCheck.Allowed      => None
      case ScopeCheck.InvalidToken => Some("Not allowed for this token: it is invalid or expired.")
      case ScopeCheck.MissingScope(scopes) if conf.WebKnossos.TokenScopes.enforced =>
        logger.info(s"Denying $describe for scoped token (scopes $scopes): missing scope")
        Some("Not allowed for this token, missing scope.")
      case ScopeCheck.MissingScope(scopes) =>
        logger.warn(
          s"Would deny $describe for scoped token (scopes $scopes): missing scope. " +
            "Allowing it because webKnossos.tokenScopes.enforced is false."
        )
        None
    }
  }

  private def handleDataSetAccess(idOpt: Option[String], mode: AccessMode.Value, userBox: Box[User])(using
      ctx: DBAccessContext
  ): Fox[UserAccessAnswer] = {

    def tryRead: Fox[UserAccessAnswer] =
      for {
        idStr <- idOpt.toFox
        datasetId <- ObjectId.fromString(idStr)
        datasetBox <- datasetDAO.findOne(datasetId).shiftBox
      } yield datasetBox match {
        case Full(_) => UserAccessAnswer(granted = true)
        case _       => UserAccessAnswer(granted = false, Some("No read access on dataset"))
      }

    def tryWrite: Fox[UserAccessAnswer] =
      for {
        idStr <- idOpt.toFox
        datasetId <- ObjectId.fromString(idStr)
        dataset <- datasetDAO.findOne(datasetId)(using GlobalAccessContext) ?~> Msg.Dataset.notFound(datasetId)
        isAllowed <- userBox match {
          case Full(user) => datasetService.isEditableBy(dataset, Some(user))
          case _          => Fox.successful(false)
        }
        msg = if (isAllowed) None else Some("Invalid access token")
      } yield UserAccessAnswer(isAllowed, msg)

    def tryDelete: Fox[UserAccessAnswer] =
      for {
        _ <- Fox.fromBool(conf.Features.allowDeleteDatasets) ?~> Msg.Dataset.Delete.notEnabled
        idStr <- idOpt.toFox
        datasetId <- ObjectId.fromString(idStr)
        dataset <- datasetDAO.findOne(datasetId)(using GlobalAccessContext) ?~> Msg.Dataset.notFound(datasetId)
        isAllowed = userBox match {
          case Full(user) => user._organization == dataset._organization && user.isAdmin
          case _          => false
        }
        msg = if (isAllowed) None else Some("Invalid access token")
      } yield UserAccessAnswer(isAllowed, msg)

    def tryAdministrate: Fox[UserAccessAnswer] =
      userBox match {
        case Full(user) =>
          val organizationId = idOpt.getOrElse(user._organization)
          for {
            isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(user, organizationId)
          } yield UserAccessAnswer(isTeamManagerOrAdmin || user.isDatasetManagerOf(organizationId))
        case _ => Fox.successful(UserAccessAnswer(granted = false, Some("Invalid access token")))
      }

    mode match {
      case AccessMode.read         => tryRead
      case AccessMode.write        => tryWrite
      case AccessMode.delete       => tryDelete
      case AccessMode.administrate => tryAdministrate
      case _                       => Fox.successful(UserAccessAnswer(granted = false, Some("invalid access token")))
    }
  }

  private def handleTracingAccess(
      tracingIdOpt: Option[String],
      mode: AccessMode,
      userBox: Box[User],
      token: Option[String]
  ): Fox[UserAccessAnswer] =
    if (tracingIdOpt.contains(TracingId.dummy))
      Fox.successful(sandboxAccessAnswer(mode))
    else
      for {
        tracingId <- tracingIdOpt.toFox
        annotation <- annotationInformationProvider.annotationForTracing(tracingId)(using
          GlobalAccessContext
        ) ?~> Msg.Annotation.notFound
        result <- handleAnnotationAccess(Some(annotation._id.toString), mode, userBox, token)
      } yield result

  // Dummy ids belong to sandbox annotations, which are never saved
  private def sandboxAccessAnswer(mode: AccessMode): UserAccessAnswer =
    if (mode == AccessMode.read) UserAccessAnswer(granted = true)
    else UserAccessAnswer(granted = false, Some(s"No ${mode.toString} access to sandbox annotation"))

  private def handleAnnotationAccess(
      annotationIdOpt: Option[String],
      mode: AccessMode,
      userBox: Box[User],
      token: Option[String]
  ): Fox[UserAccessAnswer] = {
    // Access is explicitly checked by userBox, not by DBAccessContext, as there is no token sharing for annotations
    // Optionally, an accessToken can be provided which explicitly looks up the read right the private link table

    def checkRestrictions(restrictions: AnnotationRestrictions) =
      mode match {
        case AccessMode.read  => restrictions.allowAccess(userBox.toOption)
        case AccessMode.write => restrictions.allowUpdateWithMutex(userBox.toOption)
        case _                => Fox.successful(false)
      }

    if (annotationIdOpt.contains(ObjectId.dummyId.toString)) {
      Fox.successful(sandboxAccessAnswer(mode))
    } else {
      for {
        annotationIdStr <- annotationIdOpt.toFox
        annotationId <- ObjectId.fromString(annotationIdStr)
        annotationBox <- annotationInformationProvider
          .provideAnnotation(annotationId, userBox.toOption)(using GlobalAccessContext)
          .shiftBox
        annotation <- annotationBox match {
          case Full(_) => annotationBox.toFox
          case _       => annotationStore.findInCache(annotationId).toFox
        }
        annotationAccessByToken <- token
          .map(annotationPrivateLinkDAO.findOneByAccessToken)
          .getOrElse(Fox.empty)
          .shiftBox
        // Private links only grant read access, and only until they expire
        allowedByToken = mode == AccessMode.read && annotationAccessByToken.exists(link =>
          annotation._id == link._annotation && !link.isExpired
        )
        restrictions <- annotationInformationProvider.restrictionsFor(
          AnnotationIdentifier(annotation.typ, annotation._id)
        )(using GlobalAccessContext) ?~> Msg.Annotation.Restrictions.notFound
        allowedByUser <- checkRestrictions(restrictions) ?~> Msg.Annotation.Restrictions.failedToCheck
        allowed = allowedByToken || allowedByUser
      } yield
        if (allowed) UserAccessAnswer(granted = true)
        else UserAccessAnswer(granted = false, Some(s"No ${mode.toString} access to tracing"))
    }
  }

  // Only writing (uploading files) is requested by the datastore, and only while the upload is unfinished.
  // Replacing the CSV of an uploaded project is authorized separately, see
  // WKRemoteDataStoreController.validateAlignmentProjectCsvReplacement.
  private def handleAlignmentProjectAccess(
      idOpt: Option[String],
      mode: AccessMode,
      userBox: Box[User]
  ): Fox[UserAccessAnswer] =
    (mode, userBox) match {
      case (AccessMode.write, Full(user)) =>
        for {
          idStr <- idOpt.toFox
          alignmentProjectId <- ObjectId.fromString(idStr)
          projectBox <- alignmentProjectDAO.findOne(alignmentProjectId)(using DBAccessContext(Some(user))).shiftBox
        } yield projectBox match {
          case Full(project) if project.isInputDataDeleted =>
            UserAccessAnswer(granted = false, Some(Msg.AlignmentProject.inputDataDeleted))
          case Full(project) if project.status != AlignmentProjectStatus.UPLOADING =>
            UserAccessAnswer(granted = false, Some(Msg.AlignmentProject.notUploading))
          case Full(_) => UserAccessAnswer(granted = true)
          case _       => UserAccessAnswer(granted = false, Some("No write access to alignment project"))
        }
      case _ =>
        Fox.successful(UserAccessAnswer(granted = false, Some(s"Unsupported access to alignment project: $mode")))
    }

  private def handleJobExportAccess(
      jobIdOpt: Option[String],
      mode: AccessMode,
      userBox: Box[User]
  ): Fox[UserAccessAnswer] =
    if (mode != AccessMode.read)
      Fox.successful(UserAccessAnswer(granted = false, Some(s"Unsupported access mode for job exports: $mode")))
    else {
      for {
        jobIdStr <- jobIdOpt.toFox
        jobId <- ObjectId.fromString(jobIdStr)
        jobBox <- jobDAO.findOne(jobId)(using DBAccessContext(userBox.toOption)).shiftBox
        answer = jobBox match {
          case Full(_) => UserAccessAnswer(granted = true)
          case _       => UserAccessAnswer(granted = false, Some(s"No $mode access to job export"))
        }
      } yield answer
    }

}
