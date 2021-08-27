package controllers

import akka.util.Timeout
import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.ResolutionRestrictions
import models.annotation.AnnotationState.Cancelled
import models.annotation._
import models.binary.{DataSetDAO, DataSetService}
import models.project.ProjectDAO
import models.task.TaskDAO
import models.team.TeamService
import models.user.time._
import models.user.{User, UserService}
import oxalis.security.WkEnv
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsArray, _}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.{ObjectId, WkConf}
import javax.inject.Inject
import models.analytics.{AnalyticsService, CreateAnnotationEvent, OpenAnnotationEvent}
import models.organization.OrganizationDAO
import oxalis.mail.{MailchimpClient, MailchimpTag}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

case class CreateExplorationalParameters(typ: String,
                                         fallbackLayerName: Option[String],
                                         resolutionRestrictions: Option[ResolutionRestrictions])
object CreateExplorationalParameters {
  implicit val jsonFormat: OFormat[CreateExplorationalParameters] = Json.format[CreateExplorationalParameters]
}

class AnnotationController @Inject()(
    annotationDAO: AnnotationDAO,
    taskDAO: TaskDAO,
    organizationDAO: OrganizationDAO,
    dataSetDAO: DataSetDAO,
    dataSetService: DataSetService,
    annotationService: AnnotationService,
    userService: UserService,
    teamService: TeamService,
    projectDAO: ProjectDAO,
    timeSpanService: TimeSpanService,
    annotationMerger: AnnotationMerger,
    tracingStoreService: TracingStoreService,
    provider: AnnotationInformationProvider,
    annotationRestrictionDefaults: AnnotationRestrictionDefaults,
    analyticsService: AnalyticsService,
    mailchimpClient: MailchimpClient,
    conf: WkConf,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  implicit val timeout: Timeout = Timeout(5 seconds)
  private val taskReopenAllowed = (conf.Features.taskReopenAllowed + (10 seconds)).toMillis

  def info(typ: String, id: String, timestamp: Long): Action[AnyContent] = sil.UserAwareAction.async {
    implicit request =>
      log() {
        val notFoundMessage =
          if (request.identity.isEmpty) "annotation.notFound.considerLoggingIn" else "annotation.notFound"
        for {
          annotation <- provider.provideAnnotation(typ, id, request.identity) ?~> notFoundMessage ~> NOT_FOUND
          _ <- bool2Fox(annotation.state != Cancelled) ?~> "annotation.cancelled"
          restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
          _ <- restrictions.allowAccess(request.identity) ?~> "notAllowed" ~> FORBIDDEN
          typedTyp <- AnnotationType.fromString(typ).toFox ?~> "annotationType.notFound" ~> NOT_FOUND
          js <- annotationService
            .publicWrites(annotation, request.identity, Some(restrictions)) ?~> "annotation.write.failed"
          _ <- Fox.runOptional(request.identity) { user =>
            if (typedTyp == AnnotationType.Task || typedTyp == AnnotationType.Explorational) {
              timeSpanService.logUserInteraction(timestamp, user, annotation) // log time when a user starts working
            } else Fox.successful(())
          }
          _ = request.identity.map { user =>
            analyticsService.track(OpenAnnotationEvent(user, annotation))
          }
        } yield Ok(js)
      }
  }

  def merge(typ: String, id: String, mergedTyp: String, mergedId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotationA <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
        annotationB <- provider.provideAnnotation(mergedTyp, mergedId, request.identity) ~> NOT_FOUND
        mergedAnnotation <- annotationMerger.mergeTwo(annotationA, annotationB, persistTracing = true, request.identity) ?~> "annotation.merge.failed"
        restrictions = annotationRestrictionDefaults.defaultsFor(mergedAnnotation)
        _ <- restrictions.allowAccess(request.identity) ?~> Messages("notAllowed") ~> FORBIDDEN
        _ <- annotationDAO.insertOne(mergedAnnotation)
        js <- annotationService.publicWrites(mergedAnnotation, Some(request.identity), Some(restrictions)) ?~> "annotation.write.failed"
      } yield JsonOk(js, Messages("annotation.merge.success"))
    }

  def loggedTime(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
      _ <- restrictions.allowAccess(request.identity) ?~> "notAllowed" ~> FORBIDDEN
      loggedTimeAsMap <- timeSpanService
        .loggedTimeOfAnnotation(annotation._id, TimeSpan.groupByMonth) ?~> "annotation.timelogging.read.failed"
    } yield {
      Ok(
        Json.arr(
          loggedTimeAsMap.map {
            case (month, duration) =>
              Json.obj("interval" -> month, "durationInSeconds" -> duration.toSeconds)
          }
        ))
    }
  }

  def reset(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, annotation._team))
      _ <- annotationService.resetToBase(annotation) ?~> "annotation.reset.failed"
      updated <- provider.provideAnnotation(typ, id, request.identity)
      json <- annotationService.publicWrites(updated, Some(request.identity))
    } yield JsonOk(json, Messages("annotation.reset.success"))
  }

  def reopen(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    def isReopenAllowed(user: User, annotation: Annotation) =
      for {
        isAdminOrTeamManager <- userService.isTeamManagerOrAdminOf(user, annotation._team)
        _ <- bool2Fox(annotation.state == AnnotationState.Finished) ?~> "annotation.reopen.notFinished"
        _ <- bool2Fox(isAdminOrTeamManager || annotation._user == user._id) ?~> "annotation.reopen.notAllowed"
        _ <- bool2Fox(isAdminOrTeamManager || System.currentTimeMillis - annotation.modified < taskReopenAllowed) ?~> "annotation.reopen.tooLate"
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

  def createExplorational(organizationName: String, dataSetName: String): Action[CreateExplorationalParameters] =
    sil.SecuredAction.async(validateJson[CreateExplorationalParameters]) { implicit request =>
      for {
        organization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext) ?~> Messages(
          "organization.notFound",
          organizationName) ~> NOT_FOUND
        dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id) ?~> Messages(
          "dataSet.notFound",
          dataSetName) ~> NOT_FOUND
        tracingType <- TracingType.values.find(_.toString == request.body.typ).toFox
        annotation <- annotationService.createExplorationalFor(
          request.identity,
          dataSet._id,
          tracingType,
          request.body.fallbackLayerName,
          request.body.resolutionRestrictions.getOrElse(ResolutionRestrictions.empty)
        ) ?~> "annotation.create.failed"
        _ = analyticsService.track(CreateAnnotationEvent(request.identity: User, annotation: Annotation))
        _ = mailchimpClient.tagUser(request.identity, MailchimpTag.HasAnnotated)
        json <- annotationService.publicWrites(annotation, Some(request.identity)) ?~> "annotation.write.failed"
      } yield JsonOk(json)
    }

  def makeHybrid(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(AnnotationType.Explorational.toString == typ) ?~> "annotation.makeHybrid.explorationalsOnly"
      annotation <- provider.provideAnnotation(typ, id, request.identity)
      organization <- organizationDAO.findOne(request.identity._organization)
      _ <- annotationService.makeAnnotationHybrid(annotation, organization.name) ?~> "annotation.makeHybrid.failed"
      updated <- provider.provideAnnotation(typ, id, request.identity)
      json <- annotationService.publicWrites(updated, Some(request.identity)) ?~> "annotation.write.failed"
    } yield JsonOk(json)
  }

  def downsample(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(AnnotationType.Explorational.toString == typ) ?~> "annotation.downsample.explorationalsOnly"
      annotation <- provider.provideAnnotation(typ, id, request.identity)
      _ <- annotationService.downsampleAnnotation(annotation) ?~> "annotation.downsample.failed"
      updated <- provider.provideAnnotation(typ, id, request.identity)
      json <- annotationService.publicWrites(updated, Some(request.identity)) ?~> "annotation.write.failed"
    } yield JsonOk(json)
  }

  def unlinkFallback(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(AnnotationType.Explorational.toString == typ) ?~> "annotation.unlinkFallback.explorationalsOnly"
      restrictions <- provider.restrictionsFor(typ, id)
      _ <- restrictions.allowUpdate(request.identity) ?~> "notAllowed" ~> FORBIDDEN
      annotation <- provider.provideAnnotation(typ, id, request.identity)
      volumeTracingId <- annotation.volumeTracingId.toFox ?~> "annotation.unlinkFallback.noVolume"
      dataSet <- dataSetDAO
        .findOne(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFoundForAnnotation" ~> NOT_FOUND
      dataSource <- dataSetService.dataSourceFor(dataSet).flatMap(_.toUsable) ?~> "dataSet.notImported"
      tracingStoreClient <- tracingStoreService.clientFor(dataSet)
      newTracingId <- tracingStoreClient.unlinkFallback(volumeTracingId, dataSource)
      _ <- annotationDAO.updateVolumeTracingId(annotation._id, newTracingId)
      updatedAnnotation <- provider.provideAnnotation(typ, id, request.identity)
      js <- annotationService.publicWrites(updatedAnnotation, Some(request.identity))
    } yield JsonOk(js)
  }

  private def finishAnnotation(typ: String, id: String, issuingUser: User, timestamp: Long)(
      implicit ctx: DBAccessContext): Fox[(Annotation, String)] =
    for {
      annotation <- provider.provideAnnotation(typ, id, issuingUser) ~> NOT_FOUND
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
      message <- annotationService.finish(annotation, issuingUser, restrictions) ?~> "annotation.finish.failed"
      updated <- provider.provideAnnotation(typ, id, issuingUser)
      _ <- timeSpanService.logUserInteraction(timestamp, issuingUser, annotation) // log time on tracing end
    } yield (updated, message)

  def finish(typ: String, id: String, timestamp: Long): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      log() {
        for {
          (updated, message) <- finishAnnotation(typ, id, request.identity, timestamp) ?~> "annotation.finish.failed"
          restrictions <- provider.restrictionsFor(typ, id)
          json <- annotationService.publicWrites(updated, Some(request.identity), Some(restrictions))
        } yield JsonOk(json, Messages(message))
      }
  }

  def finishAll(typ: String, timestamp: Long): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      log() {
        withJsonAs[JsArray](request.body \ "annotations") { annotationIds =>
          val results = Fox.serialSequence(annotationIds.value.toList) { jsValue =>
            jsValue.asOpt[String].toFox.flatMap(id => finishAnnotation(typ, id, request.identity, timestamp))
          }

          results.map { _ =>
            JsonOk(Messages("annotation.allFinished"))
          }
        }
      }
  }

  def editAnnotation(typ: String, id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
        restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
        _ <- restrictions.allowUpdate(request.identity) ?~> "notAllowed" ~> FORBIDDEN
        name = (request.body \ "name").asOpt[String]
        description = (request.body \ "description").asOpt[String]
        visibility = (request.body \ "visibility").asOpt[String]
        _ <- if (visibility.contains("Private"))
          annotationService.updateTeamsForSharedAnnotation(annotation._id, List.empty)
        else Fox.successful(())
        tags = (request.body \ "tags").asOpt[List[String]]
        _ <- Fox.runOptional(name)(annotationDAO.updateName(annotation._id, _)) ?~> "annotation.edit.failed"
        _ <- Fox
          .runOptional(description)(annotationDAO.updateDescription(annotation._id, _)) ?~> "annotation.edit.failed"
        _ <- Fox.runOptional(visibility)(annotationDAO.updateVisibility(annotation._id, _)) ?~> "annotation.edit.failed"
        _ <- Fox.runOptional(tags)(annotationDAO.updateTags(annotation._id, _)) ?~> "annotation.edit.failed"
      } yield JsonOk(Messages("annotation.edit.success"))
  }

  def annotationsForTask(taskId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      taskIdValidated <- ObjectId.parse(taskId)
      task <- taskDAO.findOne(taskIdValidated) ?~> "task.notFound" ~> NOT_FOUND
      project <- projectDAO.findOne(task._project)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
      annotations <- annotationService.annotationsFor(task._id) ?~> "task.annotation.failed"
      jsons <- Fox.serialSequence(annotations)(a => annotationService.publicWrites(a, Some(request.identity)))
    } yield Ok(JsArray(jsons.flatten))
  }

  def cancel(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
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

  def transfer(typ: String, id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
      _ <- restrictions.allowFinish(request.identity) ?~> "notAllowed" ~> FORBIDDEN
      newUserId <- (request.body \ "userId").asOpt[String].toFox ?~> "user.id.notFound" ~> NOT_FOUND
      newUserIdValidated <- ObjectId.parse(newUserId)
      updated <- annotationService.transferAnnotationToUser(typ, id, newUserIdValidated, request.identity)
      json <- annotationService.publicWrites(updated, Some(request.identity), Some(restrictions))
    } yield JsonOk(json)
  }

  def duplicate(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
      newAnnotation <- duplicateAnnotation(annotation, request.identity)
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound"
      json <- annotationService
        .publicWrites(newAnnotation, Some(request.identity), Some(restrictions)) ?~> "annotation.write.failed"
    } yield JsonOk(json)
  }

  def sharedAnnotations: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      userTeams <- userService.teamIdsFor(request.identity._id)
      sharedAnnotations <- annotationService.sharedAnnotationsFor(userTeams)
      json <- Fox.serialCombined(sharedAnnotations)(annotationService.compactWrites(_))
    } yield Ok(Json.toJson(json))
  }

  def getSharedTeams(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity)
      _ <- bool2Fox(annotation._user == request.identity._id) ?~> "notAllowed" ~> FORBIDDEN
      teams <- annotationService.sharedTeamsFor(annotation._id)
      json <- Fox.serialCombined(teams)(teamService.publicWrites(_))
    } yield Ok(Json.toJson(json))
  }

  def updateSharedTeams(typ: String, id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      withJsonBodyAs[List[String]] { teams =>
        for {
          annotation <- provider.provideAnnotation(typ, id, request.identity)
          _ <- bool2Fox(
            annotation._user == request.identity._id && annotation.visibility != AnnotationVisibility.Private) ?~> "notAllowed" ~> FORBIDDEN
          teamIdsValidated <- Fox.serialCombined(teams)(ObjectId.parse(_))
          userTeams <- userService.teamIdsFor(request.identity._id)
          updateTeams = teamIdsValidated.intersect(userTeams)
          _ <- annotationService.updateTeamsForSharedAnnotation(annotation._id, updateTeams)
        } yield Ok(Json.toJson(updateTeams.map(_.toString)))
      }
  }

  private def duplicateAnnotation(annotation: Annotation, user: User)(implicit ctx: DBAccessContext,
                                                                      m: MessagesProvider): Fox[Annotation] =
    for {
      // GlobalAccessContext is allowed here because the user was already allowed to see the annotation
      dataSet <- dataSetDAO.findOne(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFoundForAnnotation" ~> NOT_FOUND
      _ <- bool2Fox(dataSet.isUsable) ?~> Messages("dataSet.notImported", dataSet.name)
      dataSource <- if (annotation._task.isDefined)
        dataSetService.dataSourceFor(dataSet).flatMap(_.toUsable).map(Some(_))
      else Fox.successful(None)
      tracingStoreClient <- tracingStoreService.clientFor(dataSet)
      newSkeletonTracingReference <- Fox.runOptional(annotation.skeletonTracingId)(
        id =>
          tracingStoreClient
            .duplicateSkeletonTracing(id, None, annotation._task.isDefined)) ?~> "Failed to duplicate skeleton tracing."
      newVolumeTracingReference <- Fox.runOptional(annotation.volumeTracingId)(id =>
        tracingStoreClient.duplicateVolumeTracing(id, annotation._task.isDefined, dataSource.map(_.boundingBox))) ?~> "Failed to duplicate volume tracing."
      clonedAnnotation <- annotationService.createFrom(user,
                                                       dataSet,
                                                       newSkeletonTracingReference,
                                                       newVolumeTracingReference,
                                                       AnnotationType.Explorational,
                                                       None,
                                                       annotation.description) ?~> Messages("annotation.create.failed")
    } yield clonedAnnotation
}
