package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.annotation.{
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
import models.task.TaskDAO
import models.team.{TeamDAO, TeamService}
import models.user.time._
import models.user.{User, UserDAO, UserService}
import org.apache.pekko.util.Timeout
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import play.silhouette.api.Silhouette
import security.{URLSharing, UserAwareRequestLogging, WkEnv}
import telemetry.SlackNotificationService
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class AnnotationController @Inject()(
    annotationDAO: AnnotationDAO,
    annotationLayerDAO: AnnotationLayerDAO,
    taskDAO: TaskDAO,
    userDAO: UserDAO,
    datasetDAO: DatasetDAO,
    datasetService: DatasetService,
    annotationService: AnnotationService,
    annotationMutexService: AnnotationMutexService,
    userService: UserService,
    teamService: TeamService,
    projectDAO: ProjectDAO,
    teamDAO: TeamDAO,
    timeSpanService: TimeSpanService,
    annotationMerger: AnnotationMerger,
    tracingStoreService: TracingStoreService,
    provider: AnnotationInformationProvider,
    annotationRestrictionDefaults: AnnotationRestrictionDefaults,
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

  def info( // Type of the annotation, one of Task, Explorational, CompoundTask, CompoundProject, CompoundTaskType
           typ: String,
           // For Task and Explorational annotations, id is an annotation id. For CompoundTask, id is a task id. For CompoundProject, id is a project id. For CompoundTaskType, id is a task type id
           id: ObjectId,
           // Timestamp in milliseconds (time at which the request is sent)
           timestamp: Option[Long]): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    log() {
      val notFoundMessage =
        if (request.identity.isEmpty) "annotation.notFound.considerLoggingIn" else "annotation.notFound"
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity) ?~> notFoundMessage ~> NOT_FOUND
        _ <- Fox.fromBool(annotation.state != Cancelled) ?~> "annotation.cancelled"
        restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
        _ <- restrictions.allowAccess(request.identity) ?~> "notAllowed" ~> FORBIDDEN
        typedTyp <- AnnotationType.fromString(typ).toFox ?~> "annotationType.notFound" ~> NOT_FOUND
        js <- annotationService
          .publicWrites(annotation, request.identity, Some(restrictions)) ?~> "annotation.write.failed"
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
        annotation <- provider.provideAnnotation(id, request.identity) ?~> "annotation.notFound" ~> NOT_FOUND
        result <- Fox.fromFuture(info(annotation.typ.toString, id, timestamp)(request))
      } yield result

    }
  }

  def merge(typ: String, id: ObjectId, mergedTyp: String, mergedId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotationA <- provider.provideAnnotation(typ, id, request.identity) ?~> "annotation.notFound" ~> NOT_FOUND
        annotationB <- provider.provideAnnotation(mergedTyp, mergedId, request.identity) ?~> "annotation.notFound" ~> NOT_FOUND
        mergedAnnotation <- annotationMerger.mergeTwo(annotationA, annotationB, request.identity) ?~> "annotation.merge.failed"
        restrictions = annotationRestrictionDefaults.defaultsFor(mergedAnnotation)
        _ <- restrictions.allowAccess(request.identity) ?~> Messages("notAllowed") ~> FORBIDDEN
        _ <- annotationDAO.insertOne(mergedAnnotation)
        js <- annotationService.publicWrites(mergedAnnotation, Some(request.identity), Some(restrictions)) ?~> "annotation.write.failed"
      } yield JsonOk(js, Messages("annotation.merge.success"))
    }

  def mergeWithoutType(id: ObjectId, mergedTyp: String, mergedId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(id, request.identity) ?~> "annotation.notFound" ~> NOT_FOUND
        result <- Fox.fromFuture(merge(annotation.typ.toString, id, mergedTyp, mergedId)(request))
      } yield result
    }

  def reset(typ: String, id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ?~> "annotation.notFound" ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, annotation._team))
      _ <- annotationService.resetToBase(annotation) ?~> "annotation.reset.failed"
      updated <- provider.provideAnnotation(typ, id, request.identity)
      json <- annotationService.publicWrites(updated, Some(request.identity))
    } yield JsonOk(json, Messages("annotation.reset.success"))
  }

  def reopen(typ: String, id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    def isReopenAllowed(user: User, annotation: Annotation) =
      for {
        isAdminOrTeamManager <- userService.isTeamManagerOrAdminOf(user, annotation._team)
        _ <- Fox.fromBool(annotation.state == AnnotationState.Finished) ?~> "annotation.reopen.notFinished"
        _ <- Fox.fromBool(isAdminOrTeamManager || annotation._user == user._id) ?~> "annotation.reopen.notAllowed"
        _ <- Fox
          .fromBool(isAdminOrTeamManager || (annotation.modified + taskReopenAllowed).isPast) ?~> "annotation.reopen.tooLate"
      } yield ()

    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity)
      _ <- isReopenAllowed(request.identity, annotation) ?~> "annotation.reopen.failed"
      _ = logger.info(
        s"Reopening annotation $id, new state will be ${AnnotationState.Active.toString}, access context: ${request.identity.toStringAnonymous}")
      _ <- annotationDAO.updateState(annotation._id, AnnotationState.Active) ?~> "annotation.invalid"
      updatedAnnotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
      json <- annotationService.publicWrites(updatedAnnotation, Some(request.identity)) ?~> "annotation.write.failed"
    } yield JsonOk(json, Messages("annotation.reopened"))
  }

  def editLockedState(typ: String, id: ObjectId, isLockedByOwner: Boolean): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity)
        _ <- Fox.fromBool(annotation._user == request.identity._id) ?~> "annotation.isLockedByOwner.notAllowed"
        _ <- Fox.fromBool(annotation.typ == AnnotationType.Explorational) ?~> "annotation.isLockedByOwner.explorationalsOnly"
        _ = logger.info(
          s"Locking annotation $id, new locked state will be ${isLockedByOwner.toString}, access context: ${request.identity.toStringAnonymous}")
        _ <- annotationDAO.updateLockedState(annotation._id, isLockedByOwner) ?~> "annotation.invalid"
        updatedAnnotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
        json <- annotationService.publicWrites(updatedAnnotation, Some(request.identity)) ?~> "annotation.write.failed"
      } yield JsonOk(json, Messages("annotation.isLockedByOwner.success"))
    }

  def createExplorational(datasetId: ObjectId): Action[List[AnnotationLayerParameters]] =
    sil.SecuredAction.async(validateJson[List[AnnotationLayerParameters]]) { implicit request =>
      for {
        dataset <- datasetDAO.findOne(datasetId) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
        annotation <- annotationService.createExplorationalFor(
          request.identity,
          dataset,
          request.body
        ) ?~> "annotation.create.failed"
        _ = analyticsService.track(CreateAnnotationEvent(request.identity: User, annotation: Annotation))
        _ = mailchimpClient.tagUser(request.identity, MailchimpTag.HasAnnotated)
        json <- annotationService.publicWrites(annotation, Some(request.identity)) ?~> "annotation.write.failed"
      } yield JsonOk(json)
    }

  def getSandbox(datasetId: ObjectId, typ: String, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken) // users with dataset sharing token may also get a sandbox annotation
      for {
        dataset <- datasetDAO.findOne(datasetId)(ctx) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
        tracingType <- TracingType.fromString(typ).toFox
        _ <- Fox.fromBool(tracingType == TracingType.skeleton) ?~> "annotation.sandbox.skeletonOnly"
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
        json <- annotationService.publicWrites(annotation, request.identity) ?~> "annotation.write.failed"
      } yield JsonOk(json)
    }

  private def finishAnnotation(typ: String, id: ObjectId, issuingUser: User, timestamp: Instant)(
      implicit ctx: DBAccessContext): Fox[(Annotation, String)] =
    for {
      annotation <- provider.provideAnnotation(typ, id, issuingUser) ~> NOT_FOUND
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
      message <- annotationService.finish(annotation, issuingUser, restrictions) ?~> "annotation.finish.failed"
      updated <- provider.provideAnnotation(typ, id, issuingUser)
      _ <- timeSpanService.logUserInteractionIfTheyArePotentialContributor(timestamp, issuingUser, annotation) // log time on tracing end
    } yield (updated, message)

  def finish(typ: String, id: ObjectId, timestamp: Long): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      log() {
        for {
          (updated, message) <- finishAnnotation(typ, id, request.identity, Instant(timestamp)) ?~> "annotation.finish.failed"
          restrictions <- provider.restrictionsFor(typ, id)
          json <- annotationService.publicWrites(updated, Some(request.identity), Some(restrictions))
        } yield JsonOk(json, Messages(message))
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
            JsonOk(Messages("annotation.allFinished"))
          }
        }
      }
  }

  def editAnnotation(typ: String, id: ObjectId): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
        restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
        _ <- restrictions.allowUpdate(request.identity) ?~> "notAllowed" ~> FORBIDDEN
        name = (request.body \ "name").asOpt[String]
        visibility = (request.body \ "visibility").asOpt[AnnotationVisibility.Value]
        _ <- if (visibility.contains(AnnotationVisibility.Private))
          annotationService.updateTeamsForSharedAnnotation(annotation._id, List.empty)
        else Fox.successful(())
        tags = (request.body \ "tags").asOpt[List[String]]
        viewConfiguration = (request.body \ "viewConfiguration").asOpt[JsObject]
        _ <- Fox.runOptional(name)(annotationDAO.updateName(annotation._id, _)) ?~> "annotation.edit.failed"
        _ <- Fox.runOptional(visibility)(annotationDAO.updateVisibility(annotation._id, _)) ?~> "annotation.edit.failed"
        _ <- Fox.runOptional(tags)(annotationDAO.updateTags(annotation._id, _)) ?~> "annotation.edit.failed"
        _ <- Fox
          .runOptional(viewConfiguration)(vc => annotationDAO.updateViewConfiguration(annotation._id, Some(vc))) ?~> "annotation.edit.failed"
      } yield JsonOk(Messages("annotation.edit.success"))
  }

  def editAnnotationLayer(typ: String, id: ObjectId, tracingId: String): Action[JsValue] =
    sil.SecuredAction.async(parse.json) { implicit request =>
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
        restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
        _ <- restrictions.allowUpdate(request.identity) ?~> "notAllowed" ~> FORBIDDEN
        newLayerName = (request.body \ "name").as[String]
        _ <- annotationLayerDAO.updateName(annotation._id, tracingId, newLayerName) ?~> "annotation.edit.failed"
      } yield JsonOk(Messages("annotation.edit.success"))
    }

  def annotationsForTask(taskId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        task <- taskDAO.findOne(taskId) ?~> "task.notFound" ~> NOT_FOUND
        project <- projectDAO.findOne(task._project)
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
        annotations <- annotationService.annotationsFor(task._id) ?~> "task.annotation.failed"
        jsons <- Fox.serialCombined(annotations)(a => annotationService.publicWrites(a, Some(request.identity)))
      } yield Ok(JsArray(jsons))
    }

  def cancel(typ: String, id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    def tryToCancel(annotation: Annotation) =
      annotation match {
        case t if t.typ == AnnotationType.Task =>
          logger.info(
            s"Canceling annotation $id, new state will be ${AnnotationState.Cancelled.toString}, access context: ${request.identity.toStringAnonymous}")
          annotationDAO.updateState(annotation._id, Cancelled).map { _ =>
            JsonOk(Messages("task.finished"))
          }
        case _ =>
          Fox.successful(JsonOk(Messages("annotation.finished")))
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
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
      _ <- restrictions.allowFinish(request.identity) ?~> "notAllowed" ~> FORBIDDEN
      newUserId <- (request.body \ "userId").asOpt[String].toFox ?~> "user.id.notFound" ~> NOT_FOUND
      newUserIdValidated <- ObjectId.fromString(newUserId)
      updated <- annotationService.transferAnnotationToUser(typ, id, newUserIdValidated, request.identity)
      json <- annotationService.publicWrites(updated, Some(request.identity), Some(restrictions))
    } yield JsonOk(json)
  }

  def duplicate(typ: String, id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
      newAnnotation <- duplicateAnnotation(annotation, request.identity) ?~> "annotation.duplicate.failed"
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound"
      json <- annotationService
        .publicWrites(newAnnotation, Some(request.identity), Some(restrictions)) ?~> "annotation.write.failed"
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
          annotationDAO.countAllListableExplorationals(isFinished)) ?~> "annotation.countReadable.failed"
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
      _ <- Fox.fromBool(annotation._user == request.identity._id) ?~> "notAllowed" ~> FORBIDDEN
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
            annotation._user == request.identity._id && annotation.visibility != AnnotationVisibility.Private) ?~> "notAllowed" ~> FORBIDDEN
          teamIdsValidated <- Fox.serialCombined(teams)(ObjectId.fromString)
          _ <- Fox.serialCombined(teamIdsValidated)(teamDAO.findOne(_)) ?~> "updateSharedTeams.failed.accessingTeam"
          _ <- annotationService.updateTeamsForSharedAnnotation(annotation._id, teamIdsValidated)
        } yield Ok(Json.toJson(teamIdsValidated))
      }
  }

  def updateOthersMayEdit(typ: String, id: ObjectId, othersMayEdit: Boolean): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity)
        _ <- Fox.fromBool(annotation.typ == AnnotationType.Explorational || annotation.typ == AnnotationType.Task) ?~> "annotation.othersMayEdit.onlyExplorationalOrTask"
        _ <- Fox.fromBool(annotation._user == request.identity._id) ?~> "notAllowed" ~> FORBIDDEN
        _ <- annotationDAO.updateOthersMayEdit(annotation._id, othersMayEdit)
      } yield Ok(Json.toJson(othersMayEdit))
    }

  private def duplicateAnnotation(annotation: Annotation, user: User)(implicit ctx: DBAccessContext,
                                                                      m: MessagesProvider): Fox[Annotation] =
    for {
      // GlobalAccessContext is allowed here because the user was already allowed to see the annotation
      dataset <- datasetDAO.findOne(annotation._dataset)(GlobalAccessContext) ?~> "dataset.notFoundForAnnotation" ~> NOT_FOUND
      _ <- Fox.fromBool(dataset.isUsable) ?~> Messages("dataset.notImported", dataset.name)
      dataSource <- if (annotation._task.isDefined)
        datasetService.dataSourceFor(dataset).flatMap(_.toUsable.toFox).map(Some(_))
      else Fox.successful(None)
      tracingStoreClient <- tracingStoreService.clientFor(dataset)
      newAnnotationId = ObjectId.generate
      newAnnotationProto <- tracingStoreClient.duplicateAnnotation(
        annotation._id,
        newAnnotationId,
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
                                                       newAnnotationId) ?~> Messages("annotation.create.failed")
      _ <- annotationDAO.insertOne(clonedAnnotation)
    } yield clonedAnnotation

  def tryAcquiringAnnotationMutex(id: ObjectId): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      logTime(slackNotificationService.noticeSlowRequest, durationThreshold = 1 second) {
        for {
          annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
          _ <- Fox.fromBool(annotation.othersMayEdit) ?~> "notAllowed" ~> FORBIDDEN
          restrictions <- provider.restrictionsFor(AnnotationIdentifier(annotation.typ, id)) ?~> "restrictions.notFound" ~> NOT_FOUND
          _ <- restrictions.allowUpdate(request.identity) ?~> "notAllowed" ~> FORBIDDEN
          mutexResult <- annotationMutexService.tryAcquiringAnnotationMutex(annotation._id, request.identity._id) ?~> "annotation.mutex.failed"
          resultJson <- annotationMutexService.publicWrites(mutexResult)
        } yield Ok(resultJson)
      }
    }

}
