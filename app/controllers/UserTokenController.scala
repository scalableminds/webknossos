package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
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
import models.organization.OrganizationDAO
import models.user.{User, UserService}
import com.scalableminds.util.tools.{Box, Full}
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
                                    organizationDAO: OrganizationDAO,
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
      implicit ec: ExecutionContext): Fox[Result] =
    if (token.contains(RpcTokenHolder.webknossosToken)) {
      Fox.successful(Ok(Json.toJson(UserAccessAnswer(granted = true))))
    } else {
      for {
        userBox <- bearerTokenService.userForTokenOpt(token).shiftBox
        sharingTokenAccessCtx = URLSharing.fallbackTokenAccessContext(token)(DBAccessContext(userBox.toOption))
        answer <- accessRequest.resourceType match {
          case AccessResourceType.datasource =>
            handleDataSourceAccess(accessRequest.resourceId, accessRequest.mode, userBox)(sharingTokenAccessCtx)
          case AccessResourceType.dataset =>
            handleDataSetAccess(accessRequest.resourceId.directoryName, accessRequest.mode, userBox)(
              sharingTokenAccessCtx)
          case AccessResourceType.tracing =>
            handleTracingAccess(accessRequest.resourceId.directoryName, accessRequest.mode, userBox, token)
          case AccessResourceType.annotation =>
            handleAnnotationAccess(accessRequest.resourceId.directoryName, accessRequest.mode, userBox, token)
          case AccessResourceType.jobExport =>
            handleJobExportAccess(accessRequest.resourceId.directoryName, accessRequest.mode, userBox)
          case _ =>
            Fox.successful(UserAccessAnswer(granted = false, Some("Invalid access token.")))
        }
      } yield Ok(Json.toJson(answer))
    }

  private def handleDataSourceAccess(dataSourceId: DataSourceId, mode: AccessMode, userBox: Box[User])(
      implicit ctx: DBAccessContext): Fox[UserAccessAnswer] = {
    // Write access is explicitly handled here depending on userBox,
    // Read access is ensured in findOneBySourceName, depending on the implicit DBAccessContext (to allow sharingTokens)

    def tryRead: Fox[UserAccessAnswer] =
      for {
        dataSourceBox <- datasetDAO.findOneByDataSourceId(dataSourceId).shiftBox
      } yield
        dataSourceBox match {
          case Full(_) => UserAccessAnswer(granted = true)
          case _       => UserAccessAnswer(granted = false, Some("No read access on dataset"))
        }

    def tryWrite: Fox[UserAccessAnswer] =
      for {
        dataset <- datasetDAO.findOneByDataSourceId(dataSourceId) ?~> "datasource.notFound"
        user <- userBox.toFox ?~> "auth.token.noUser"
        isAllowed <- datasetService.isEditableBy(dataset, Some(user))
      } yield UserAccessAnswer(isAllowed)

    def tryAdministrate: Fox[UserAccessAnswer] =
      userBox match {
        case Full(user) =>
          for {
            // if dataSourceId is empty, the request asks if the user may administrate in *any* (i.e. their own) organization
            relevantOrganization <- if (dataSourceId.organizationId.isEmpty)
              Fox.successful(user._organization)
            else organizationDAO.findOne(dataSourceId.organizationId).map(_._id)
            isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(user, relevantOrganization)
          } yield UserAccessAnswer(isTeamManagerOrAdmin || user.isDatasetManager)
        case _ => Fox.successful(UserAccessAnswer(granted = false, Some("invalid access token")))
      }

    def tryDelete: Fox[UserAccessAnswer] =
      for {
        _ <- Fox.fromBool(conf.Features.allowDeleteDatasets) ?~> "dataset.delete.disabled"
        dataset <- datasetDAO.findOneByDataSourceId(dataSourceId)(GlobalAccessContext) ?~> "datasource.notFound"
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

  def handleDataSetAccess(id: String, mode: AccessMode.Value, userBox: Box[User])(
      implicit ctx: DBAccessContext): Fox[UserAccessAnswer] = {

    def tryRead: Fox[UserAccessAnswer] =
      for {
        datasetId <- ObjectId.fromString(id)
        datasetBox <- datasetDAO.findOne(datasetId).shiftBox
      } yield
        datasetBox match {
          case Full(_) => UserAccessAnswer(granted = true)
          case _       => UserAccessAnswer(granted = false, Some("No read access on dataset"))
        }

    def tryWrite: Fox[UserAccessAnswer] =
      for {
        datasetId <- ObjectId.fromString(id)
        dataset <- datasetDAO.findOne(datasetId)(GlobalAccessContext) ?~> "dataset.notFound"
        user <- userBox.toFox ?~> "auth.token.noUser"
        isAllowed <- datasetService.isEditableBy(dataset, Some(user))
      } yield UserAccessAnswer(isAllowed)

    mode match {
      case AccessMode.read  => tryRead
      case AccessMode.write => tryWrite
      case _                => Fox.successful(UserAccessAnswer(granted = false, Some("invalid access token")))
    }
  }

  private def handleTracingAccess(tracingId: String,
                                  mode: AccessMode,
                                  userBox: Box[User],
                                  token: Option[String]): Fox[UserAccessAnswer] =
    if (tracingId == TracingId.dummy)
      Fox.successful(UserAccessAnswer(granted = true))
    else
      for {
        annotation <- annotationInformationProvider.annotationForTracing(tracingId)(GlobalAccessContext) ?~> "annotation.notFound"
        result <- handleAnnotationAccess(annotation._id.toString, mode, userBox, token)
      } yield result

  private def handleAnnotationAccess(annotationId: String,
                                     mode: AccessMode,
                                     userBox: Box[User],
                                     token: Option[String]): Fox[UserAccessAnswer] = {
    // Access is explicitly checked by userBox, not by DBAccessContext, as there is no token sharing for annotations
    // Optionally, an accessToken can be provided which explicitly looks up the read right the private link table

    def checkRestrictions(restrictions: AnnotationRestrictions) =
      mode match {
        case AccessMode.read  => restrictions.allowAccess(userBox.toOption)
        case AccessMode.write => restrictions.allowUpdate(userBox.toOption)
        case _                => Fox.successful(false)
      }

    if (annotationId == ObjectId.dummyId.toString) {
      Fox.successful(UserAccessAnswer(granted = true))
    } else {
      for {
        annotationId <- ObjectId.fromString(annotationId)
        annotationBox <- annotationInformationProvider
          .provideAnnotation(annotationId, userBox.toOption)(GlobalAccessContext)
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

  private def handleJobExportAccess(jobId: String, mode: AccessMode, userBox: Box[User]): Fox[UserAccessAnswer] =
    if (mode != AccessMode.read)
      Fox.successful(UserAccessAnswer(granted = false, Some(s"Unsupported access mode for job exports: $mode")))
    else {
      for {
        jobIdValidated <- ObjectId.fromString(jobId)
        jobBox <- jobDAO.findOne(jobIdValidated)(DBAccessContext(userBox.toOption)).shiftBox
        answer = jobBox match {
          case Full(_) => UserAccessAnswer(granted = true)
          case _       => UserAccessAnswer(granted = false, Some(s"No $mode access to job export"))
        }
      } yield answer
    }
}
