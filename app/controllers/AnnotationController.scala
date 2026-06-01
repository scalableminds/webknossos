package controllers

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationIdDomain.AnnotationIdDomain
import com.scalableminds.webknossos.datastore.models.annotation.{
  AnnotationIdDomain,
  AnnotationLayer,
  AnnotationLayerStatistics,
  AnnotationLayerType
}
import com.scalableminds.webknossos.tracingstore.annotation.AnnotationLayerParameters
import com.scalableminds.webknossos.tracingstore.tracings.{TracingId, TracingType}
import mail.{MailchimpClient, MailchimpTag}
import models.analytics.{AnalyticsService, CreateAnnotationEvent, OpenAnnotationEvent}
import models.annotation.AnnotationState.Cancelled
import models.annotation._
import models.dataset.{DatasetDAO, DatasetService}
import models.project.ProjectDAO
import models.task.{TaskDAO, TaskService}
import models.team.{TeamDAO, TeamService}
import models.user.time._
import models.user.{User, UserDAO, UserService}
import org.apache.pekko.util.Timeout
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import play.silhouette.api.Silhouette
import security.{URLSharing, UserAwareRequestLogging, WkEnv}
import telemetry.SlackNotificationService
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

case class ReserveIdRequest(
    domain: AnnotationIdDomain,
    tracingId: String,
    numberOfIdsToReserve: Int,
    idsToRelease: Seq[Long]
)
object ReserveIdRequest {
  implicit val jsonFormat: OFormat[ReserveIdRequest] = Json.format[ReserveIdRequest]
}

class AnnotationController @Inject()(
    annotationDAO: AnnotationDAO,
    taskDAO: TaskDAO,
    userDAO: UserDAO,
    datasetDAO: DatasetDAO,
    datasetService: DatasetService,
    annotationService: AnnotationService,
    annotationMutexService: AnnotationMutexService,
    annotationIdReservationService: AnnotationReservedIdsService,
    userService: UserService,
    teamService: TeamService,
    projectDAO: ProjectDAO,
    teamDAO: TeamDAO,
    timeSpanService: TimeSpanService,
    annotationMerger: AnnotationMerger,
    tracingStoreService: TracingStoreService,
    provider: AnnotationInformationProvider,
    annotationRestrictionDefaults: AnnotationRestrictionDefaults,
    taskService: TaskService,
    analyticsService: AnalyticsService,
    slackNotificationService: SlackNotificationService,
    mailchimpClient: MailchimpClient,
    conf: WkConf,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with UserAwareRequestLogging
    with FoxImplicits {

  implicit val timeout: Timeout = Timeout(5 seconds)
  private val taskReopenAllowed = conf.Features.taskReopenAllowed + (10 seconds)

  private val numberOfIdsToReservePerRequest = 10

  def info( // Type of the annotation, one of Task, Explorational, CompoundTask, CompoundProject, CompoundTaskType
           typ: String,
           // For Task and Explorational annotations, id is an annotation id. For CompoundTask, id is a task id. For CompoundProject, id is a project id. For CompoundTaskType, id is a task type id
           id: ObjectId,
           // Timestamp in milliseconds (time at which the request is sent)
           timestamp: Option[Long]): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    log() {
      val notFoundMessage =
        if (request.identity.isEmpty) Msg.Annotation.notFoundConsiderLogin else Msg.Annotation.notFound
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity) ?~> notFoundMessage ~> NOT_FOUND
        _ <- Fox.fromBool(annotation.state != Cancelled) ?~> Msg.Annotation.cancelled
        restrictions <- provider.restrictionsFor(typ, id) ?~> Msg.Annotation.Restrictions.notFound ~> NOT_FOUND
        _ <- restrictions.allowAccess(request.identity) ?~> Msg.notAllowed ~> FORBIDDEN
        typedTyp <- AnnotationType.fromString(typ).toFox ?~> Msg.Annotation.invalidType(typ) ~> NOT_FOUND
        js <- annotationService
          .publicWrites(annotation, request.identity, Some(restrictions)) ?~> Msg.Annotation.publicWritesFailed
        _ <- Fox.runOptional(request.identity) { user =>
          Fox.runOptional(timestamp) { timestampDefined =>
            if (typedTyp == AnnotationType.Task || typedTyp == AnnotationType.Explorational) {
              timeSpanService.logUserInteractionIfTheyArePotentialContributor(
                Instant(timestampDefined),
                user,
                annotation) // log time when a user starts working
            } else Fox.successful(())
          }
        }
        _ = Fox.runOptional(request.identity)(user => userDAO.updateLastActivity(user._id))
        _ = request.identity.foreach { user =>
          analyticsService.track(OpenAnnotationEvent(user, annotation))
        }
      } yield Ok(js)
    }
  }

  def infoWithoutType(id: ObjectId,
                      // Timestamp in milliseconds (time at which the request is sent)
                      timestamp: Option[Long]): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    log() {
      for {
        annotation <- provider.provideAnnotation(id, request.identity) ?~> Msg.Annotation.notFound ~> NOT_FOUND
        result <- Fox.fromFuture(info(annotation.typ.toString, id, timestamp)(request))
      } yield result

    }
  }

  def merge(typ: String, id: ObjectId, mergedTyp: String, mergedId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotationA <- provider.provideAnnotation(typ, id, request.identity) ?~> Msg.Annotation.notFound ~> NOT_FOUND
        annotationB <- provider.provideAnnotation(mergedTyp, mergedId, request.identity) ?~> Msg.Annotation.notFound ~> NOT_FOUND
        mergedAnnotation <- annotationMerger.mergeTwo(annotationA, annotationB, request.identity) ?~> Msg.Annotation.Merge.failed
        restrictions = annotationRestrictionDefaults.defaultsFor(mergedAnnotation)
        _ <- restrictions.allowAccess(request.identity) ?~> Msg.Annotation.Merge.noAccessOnMerged ~> FORBIDDEN
        _ <- annotationDAO.insertOne(mergedAnnotation)
        js <- annotationService.publicWrites(mergedAnnotation, Some(request.identity), Some(restrictions)) ?~> Msg.Annotation.publicWritesFailed
      } yield JsonOk(js, Msg.Annotation.Merge.success)
    }

  def mergeWithoutType(id: ObjectId, mergedTyp: String, mergedId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(id, request.identity) ?~> Msg.Annotation.notFound ~> NOT_FOUND
        result <- Fox.fromFuture(merge(annotation.typ.toString, id, mergedTyp, mergedId)(request))
      } yield result
    }

  def reset(typ: String, id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ?~> Msg.Annotation.notFound ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, annotation._team))
      _ <- annotationService.resetToBase(annotation) ?~> Msg.Annotation.Reset.failed
      updated <- provider.provideAnnotation(typ, id, request.identity)
      json <- annotationService.publicWrites(updated, Some(request.identity))
    } yield JsonOk(json, Msg.Annotation.Reset.success)
  }

  def reopen(typ: String, id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    def isReopenAllowed(user: User, annotation: Annotation) =
      for {
        isAdminOrTeamManager <- userService.isTeamManagerOrAdminOf(user, annotation._team)
        _ <- Fox.fromBool(annotation.state == AnnotationState.Finished) ?~> Msg.Annotation.Reopen.notFinished
        _ <- Fox.fromBool(isAdminOrTeamManager || annotation._user == user._id) ?~> Msg.Annotation.Reopen.notAllowed
        _ <- Fox
          .fromBool(isAdminOrTeamManager || (annotation.modified + taskReopenAllowed).isPast) ?~> Msg.Annotation.Reopen
          .tooLate(conf.Features.taskReopenAllowed)
      } yield ()

    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity)
      _ <- isReopenAllowed(request.identity, annotation) ?~> Msg.Annotation.Reopen.failed
      _ = logger.info(
        s"Reopening annotation $id, new state will be ${AnnotationState.Active.toString}, access context: ${request.identity.toStringAnonymous}")
      _ <- annotationDAO.updateState(annotation._id, AnnotationState.Active) ?~> Msg.Annotation.Reopen.updateStateFailed
      _ <- Fox.runOptional(annotation._task)(taskService.clearCompoundCache)
      updatedAnnotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
      json <- annotationService
        .publicWrites(updatedAnnotation, Some(request.identity)) ?~> Msg.Annotation.publicWritesFailed
    } yield JsonOk(json, Msg.Annotation.Reopen.success)
  }

  def editLockedState(typ: String, id: ObjectId, isLockedByOwner: Boolean): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity)
        _ <- Fox.fromBool(annotation._user == request.identity._id) ?~> Msg.Annotation.Lock.notAllowed
        _ <- Fox.fromBool(annotation.typ == AnnotationType.Explorational) ?~> Msg.Annotation.Lock.explorationalsOnly
        _ = logger.info(
          s"Locking annotation $id, new locked state will be ${isLockedByOwner.toString}, access context: ${request.identity.toStringAnonymous}")
        _ <- annotationDAO.updateLockedState(annotation._id, isLockedByOwner) ?~> Msg.Annotation.Lock.failed
        updatedAnnotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
        json <- annotationService.publicWrites(updatedAnnotation, Some(request.identity)) ?~> Msg.Annotation.publicWritesFailed
      } yield JsonOk(json, Msg.Annotation.Lock.success)
    }

  def createExplorational(datasetId: ObjectId): Action[List[AnnotationLayerParameters]] =
    sil.SecuredAction.async(validateJson[List[AnnotationLayerParameters]]) { implicit request =>
      for {
        dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
        annotation <- annotationService.createExplorationalFor(
          request.identity,
          dataset,
          request.body
        ) ?~> Msg.Annotation.createFailed
        _ = analyticsService.track(CreateAnnotationEvent(request.identity: User, annotation: Annotation))
        _ = mailchimpClient.tagUser(request.identity, MailchimpTag.HasAnnotated)
        json <- annotationService.publicWrites(annotation, Some(request.identity)) ?~> Msg.Annotation.publicWritesFailed
      } yield JsonOk(json)
    }

  def getSandbox(datasetId: ObjectId, typ: String, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken) // users with dataset sharing token may also get a sandbox annotation
      for {
        dataset <- datasetDAO.findOne(datasetId)(ctx) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
        tracingType <- TracingType.fromString(typ).toFox
        _ <- Fox.fromBool(tracingType == TracingType.skeleton) ?~> Msg.Annotation.sandboxSkeletonOnly
        annotation = Annotation(
          ObjectId.dummyId,
          dataset._id,
          None,
          ObjectId.dummyId,
          ObjectId.dummyId,
          List(
            AnnotationLayer(TracingId.dummy,
                            AnnotationLayerType.Skeleton,
                            AnnotationLayer.defaultSkeletonLayerName,
                            AnnotationLayerStatistics.unknown))
        )
        json <- annotationService.publicWrites(annotation, request.identity) ?~> Msg.Annotation.publicWritesFailed
      } yield JsonOk(json)
    }

  private def finishAnnotation(typ: String, id: ObjectId, issuingUser: User, timestamp: Instant)(
      implicit ctx: DBAccessContext): Fox[(Annotation, String)] =
    for {
      annotation <- provider.provideAnnotation(typ, id, issuingUser) ~> NOT_FOUND
      restrictions <- provider.restrictionsFor(typ, id) ?~> Msg.Annotation.Restrictions.notFound ~> NOT_FOUND
      message <- annotationService.finish(annotation, issuingUser, restrictions) ?~> Msg.Annotation.finishFailed
      updated <- provider.provideAnnotation(typ, id, issuingUser)
      _ <- timeSpanService.logUserInteractionIfTheyArePotentialContributor(timestamp, issuingUser, annotation) // log time on tracing end
    } yield (updated, message)

  def finish(typ: String, id: ObjectId, timestamp: Long): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      log() {
        for {
          (updated, message) <- finishAnnotation(typ, id, request.identity, Instant(timestamp)) ?~> Msg.Annotation.finishFailed
          restrictions <- provider.restrictionsFor(typ, id)
          json <- annotationService.publicWrites(updated, Some(request.identity), Some(restrictions))
        } yield JsonOk(json, message)
      }
  }

  def finishAll(typ: String, timestamp: Long): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      log() {
        withJsonAs[JsArray](request.body \ "annotations") { annotationIds =>
          val results = Fox.serialCombined(annotationIds.value.toList) { jsValue =>
            jsValue
              .asOpt[String]
              .toFox
              .flatMap(id => finishAnnotation(typ, ObjectId(id), request.identity, Instant(timestamp)))
          }
          results.map { _ =>
            JsonOk(Msg.Annotation.allFinished)
          }
        }
      }
  }

  def editAnnotation(typ: String, id: ObjectId): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
        restrictions <- provider.restrictionsFor(typ, id) ?~> Msg.Annotation.Restrictions.notFound ~> NOT_FOUND
        _ <- restrictions.allowUpdate(request.identity) ?~> Msg.Annotation.Edit.notAllowed ~> FORBIDDEN
        name = (request.body \ "name").asOpt[String]
        visibility = (request.body \ "visibility").asOpt[AnnotationVisibility.Value]
        _ <- if (visibility.contains(AnnotationVisibility.Private))
          annotationService.updateTeamsForSharedAnnotation(annotation._id, List.empty)
        else Fox.successful(())
        tags = (request.body \ "tags").asOpt[List[String]]
        viewConfiguration = (request.body \ "viewConfiguration").asOpt[JsObject]
        _ <- Fox.runOptional(name)(annotationDAO.updateName(annotation._id, _)) ?~> Msg.Annotation.Edit.failed
        _ <- Fox
          .runOptional(visibility)(annotationDAO.updateVisibility(annotation._id, _)) ?~> Msg.Annotation.Edit.failed
        _ <- Fox.runOptional(tags)(annotationDAO.updateTags(annotation._id, _)) ?~> Msg.Annotation.Edit.failed
        _ <- Fox
          .runOptional(viewConfiguration)(vc => annotationDAO.updateViewConfiguration(annotation._id, Some(vc))) ?~> Msg.Annotation.Edit.failed
      } yield JsonOk(Msg.Annotation.Edit.success)
  }

  def annotationsForTask(taskId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        task <- taskDAO.findOne(taskId) ?~> Msg.Task.notFound(taskId) ~> NOT_FOUND
        project <- projectDAO.findOne(task._project)
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
        annotations <- annotationService.annotationsFor(task._id) ?~> Msg.Task.findAnnotationsFailed
        jsons <- Fox.serialCombined(annotations)(a => annotationService.publicWrites(a, Some(request.identity)))
      } yield Ok(JsArray(jsons))
    }

  def cancel(typ: String, id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    def tryToCancel(annotation: Annotation) =
      (annotation._task, annotation.typ) match {
        case (Some(taskId), AnnotationType.Task) =>
          logger.info(
            s"Canceling task annotation $id, new state will be ${AnnotationState.Cancelled}, access context: ${request.identity.toStringAnonymous}")
          for {
            _ <- Fox.runIf(annotation.state == AnnotationState.Finished)(taskService.clearCompoundCache(taskId))
            _ <- annotationDAO.updateState(annotation._id, Cancelled)
          } yield JsonOk(Msg.Task.cancelSuccess)
        case _ =>
          Fox.successful(JsonOk(Msg.Annotation.finished))
      }

    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, annotation._team))
      result <- tryToCancel(annotation)
    } yield result
  }

  def cancelWithoutType(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
      result <- Fox.fromFuture(cancel(annotation.typ.toString, id)(request))
    } yield result
  }

  def transfer(typ: String, id: ObjectId): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      restrictions <- provider.restrictionsFor(typ, id) ?~> Msg.Annotation.Restrictions.notFound ~> NOT_FOUND
      _ <- restrictions.allowFinish(request.identity) ?~> Msg.notAllowed ~> FORBIDDEN
      newUserId <- (request.body \ "userId").asOpt[String].toFox
      newUserIdValidated <- ObjectId.fromString(newUserId)
      updated <- annotationService.transferAnnotationToUser(typ, id, newUserIdValidated, request.identity)
      json <- annotationService.publicWrites(updated, Some(request.identity), Some(restrictions))
    } yield JsonOk(json)
  }

  def duplicate(typ: String, id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
      newAnnotation <- duplicateAnnotation(annotation, request.identity) ?~> Msg.Annotation.duplicateFailed
      restrictions <- provider.restrictionsFor(typ, id) ?~> Msg.Annotation.Restrictions.notFound ~> NOT_FOUND
      json <- annotationService
        .publicWrites(newAnnotation, Some(request.identity), Some(restrictions)) ?~> Msg.Annotation.publicWritesFailed
    } yield JsonOk(json)
  }

  // Note that this lists both the user’s own explorationals and those shared with the user’s teams

  def listExplorationals(isFinished: Option[Boolean],
                         limit: Option[Int],
                         pageNumber: Option[Int] = None,
                         includeTotalCount: Option[Boolean] = None): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotationInfos <- annotationDAO.findAllListableExplorationals(
          isFinished,
          None,
          filterOwnedOrShared = true,
          limit.getOrElse(annotationService.DefaultAnnotationListLimit),
          pageNumber.getOrElse(0)
        )
        annotationCount <- Fox.runIf(includeTotalCount.getOrElse(false))(
          annotationDAO.countAllListableExplorationals(isFinished)) ?~> Msg.Annotation.countListableFailed
        annotationInfosJsons = annotationInfos.map(annotationService.writeCompactInfo)
        _ = userDAO.updateLastActivity(request.identity._id)(GlobalAccessContext)
      } yield {
        val result = Ok(Json.toJson(annotationInfosJsons))
        annotationCount match {
          case Some(count) => result.withHeaders("X-Total-Count" -> count.toString)
          case None        => result
        }
      }

    }

  def getSharedTeams(typ: String, id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity)
      _ <- Fox.fromBool(annotation._user == request.identity._id) ?~> Msg.notAllowed ~> FORBIDDEN
      teams <- teamDAO.findSharedTeamsForAnnotation(annotation._id)
      json <- Fox.serialCombined(teams)(teamService.publicWrites(_))
    } yield Ok(Json.toJson(json))
  }

  def updateSharedTeams(typ: String, id: ObjectId): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      withJsonBodyAs[List[String]] { teams =>
        for {
          annotation <- provider.provideAnnotation(typ, id, request.identity)
          _ <- Fox.fromBool(
            annotation._user == request.identity._id && annotation.visibility != AnnotationVisibility.Private) ?~> Msg.notAllowed ~> FORBIDDEN
          teamIdsValidated <- Fox.serialCombined(teams)(ObjectId.fromString)
          _ <- Fox.serialCombined(teamIdsValidated)(teamDAO.findOne(_)) ?~> Msg.Annotation.Edit.accessingTeamFailed
          _ <- annotationService.updateTeamsForSharedAnnotation(annotation._id, teamIdsValidated)
        } yield Ok(Json.toJson(teamIdsValidated))
      }
  }

  def updateCollaborationMode(typ: String, id: ObjectId, collaborationMode: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity)
        _ <- Fox.fromBool(annotation.typ == AnnotationType.Explorational || annotation.typ == AnnotationType.Task) ?~> Msg.Annotation.CollaborationMode.onlyExplorationalOrTask
        _ <- Fox.fromBool(annotation._user == request.identity._id) ?~> Msg.notAllowed ~> FORBIDDEN
        collaborationModeValidated <- CollaborationMode.fromString(collaborationMode).toFox
        _ <- annotationDAO.updateCollaborationMode(annotation._id, collaborationModeValidated)
        _ <- Fox.runIf(
          annotation.collaborationMode == CollaborationMode.Concurrent && collaborationModeValidated != CollaborationMode.Concurrent) {
          annotationIdReservationService.releaseAllForAnnotation(id)
        }
      } yield Ok
    }

  private def duplicateAnnotation(annotation: Annotation, user: User): Fox[Annotation] =
    for {
      // GlobalAccessContext is allowed here because the user was already allowed to see the annotation
      dataset <- datasetDAO.findOne(annotation._dataset)(GlobalAccessContext) ?~> Msg.Dataset
        .notFoundForAnnotation(annotation._dataset, annotation._id) ~> NOT_FOUND
      _ <- Fox.fromBool(dataset.isUsable) ?~> Msg.Dataset.notUsable(dataset._id)
      dataSource <- if (annotation._task.isDefined)
        datasetService.usableDataSourceFor(dataset).map(Some(_))
      else Fox.successful(None)
      tracingStoreClient <- tracingStoreService.clientFor(dataset)
      newAnnotationId = ObjectId.generate
      newAnnotationProto <- tracingStoreClient.duplicateAnnotation(
        annotation._id,
        newAnnotationId,
        annotation._user,
        user._id,
        version = None,
        isFromTask = annotation._task.isDefined,
        datasetBoundingBox = dataSource.map(_.boundingBox)
      )
      newAnnotationLayers = newAnnotationProto.annotationLayers.map(AnnotationLayer.fromProto)
      clonedAnnotation <- annotationService.createFrom(user,
                                                       dataset,
                                                       newAnnotationLayers,
                                                       AnnotationType.Explorational,
                                                       None,
                                                       annotation.description,
                                                       newAnnotationId) ?~> Msg.Annotation.createFailed
      _ <- annotationDAO.insertOne(clonedAnnotation)
    } yield clonedAnnotation

  def tryAcquiringAnnotationMutex(id: ObjectId, sessionId: String = ""): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      logTime(slackNotificationService.noticeSlowRequest, durationThreshold = 1 second) {
        for {
          annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
          _ <- Fox.fromBool(
            annotation.collaborationMode == CollaborationMode.Concurrent || annotation.collaborationMode == CollaborationMode.Exclusive) ?~> Msg.notAllowed ~> FORBIDDEN
          restrictions <- provider.restrictionsFor(AnnotationIdentifier(annotation.typ, id)) ?~> Msg.Annotation.Restrictions.notFound ~> NOT_FOUND
          _ <- restrictions.allowUpdate(request.identity) ?~> Msg.notAllowed ~> FORBIDDEN
          mutexResult <- annotationMutexService.tryAcquiringAnnotationMutex(
            annotation._id,
            request.identity._id,
            sessionId) ?~> Msg.Annotation.Mutex.acquireFailed
          _ = if (mutexResult.canEdit)
            logger.info(
              s"User ${request.identity._id} with session id $sessionId acquired mutex for annotation ${annotation._id}.")
          else
            logger.info(
              s"User ${request.identity._id} with session id $sessionId tried to acquire mutex for annotation ${annotation._id} but was rejected. ${mutexResult.blockedByUser
                .map(_.toString)
                .getOrElse("")} is currently having the mutex.")
          resultJson <- annotationMutexService.publicWrites(mutexResult)
        } yield Ok(resultJson)
      }
    }

  def releaseMutex(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    logTime(slackNotificationService.noticeSlowRequest, durationThreshold = 1 second) {
      for {
        _ <- annotationMutexService.release(id, request.identity._id) ?~> Msg.Annotation.Mutex.releaseFailed
        _ = logger.info(s"User ${request.identity._id} released mutex for $id.")
      } yield Ok
    }
  }

  def reservedIds(id: ObjectId, tracingId: String, domain: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      logTime(slackNotificationService.noticeSlowRequest, durationThreshold = 1 second) {
        for {
          annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
          restrictions <- provider
            .restrictionsFor(AnnotationIdentifier(annotation.typ, id)) ?~> Msg.Annotation.Restrictions.notFound ~> NOT_FOUND
          _ <- restrictions.allowAccess(request.identity) ?~> Msg.notAllowed ~> FORBIDDEN
          domainValidated <- AnnotationIdDomain.fromString(domain).toFox
          ids: Seq[Long] <- annotationIdReservationService.reservedIds(id,
                                                                       tracingId,
                                                                       domainValidated,
                                                                       request.identity._id)
        } yield Ok(Json.toJson(ids))
      }
  }

  def reserveIds(id: ObjectId): Action[ReserveIdRequest] =
    sil.SecuredAction.async(validateJson[ReserveIdRequest]) { implicit request =>
      logTime(slackNotificationService.noticeSlowRequest, durationThreshold = 1 second) {
        for {
          annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
          restrictions <- provider.restrictionsFor(AnnotationIdentifier(annotation.typ, id)) ?~> Msg.Annotation.Restrictions.notFound ~> NOT_FOUND
          _ <- restrictions.allowUpdate(request.identity) ?~> Msg.notAllowed ~> FORBIDDEN
          // Note: this limit should match what the frontend requests, see IDEAL_ID_BUFFER_SIZE in id_reservation_saga.
          _ <- Fox.fromBool(request.body.numberOfIdsToReserve <= numberOfIdsToReservePerRequest) ?~> Msg.Annotation
            .reserveTooManyIds(numberOfIdsToReservePerRequest) ~> FORBIDDEN
          ids: Seq[Long] <- annotationIdReservationService.reserveIds(id,
                                                                      request.body.tracingId,
                                                                      request.body.domain,
                                                                      request.identity._id,
                                                                      request.body.numberOfIdsToReserve,
                                                                      request.body.idsToRelease)
        } yield Ok(Json.toJson(ids))
      }
    }

}
