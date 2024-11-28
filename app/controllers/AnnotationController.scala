package controllers

import org.apache.pekko.util.Timeout
import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType.AnnotationLayerType
import com.scalableminds.webknossos.datastore.models.annotation.{
  AnnotationLayer,
  AnnotationLayerStatistics,
  AnnotationLayerType
}
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.tracings.volume.MagRestrictions
import com.scalableminds.webknossos.tracingstore.tracings.{TracingIds, TracingType}
import mail.{MailchimpClient, MailchimpTag}
import models.analytics.{AnalyticsService, CreateAnnotationEvent, OpenAnnotationEvent}
import models.annotation.AnnotationState.Cancelled
import models.annotation._
import models.dataset.{DatasetDAO, DatasetService}
import models.organization.OrganizationDAO
import models.project.ProjectDAO
import models.task.TaskDAO
import models.team.{TeamDAO, TeamService}
import models.user.time._
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.Box
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.Json.WithDefaultValues
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{URLSharing, UserAwareRequestLogging, WkEnv}
import telemetry.SlackNotificationService
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

case class AnnotationLayerParameters(typ: AnnotationLayerType,
                                     fallbackLayerName: Option[String],
                                     autoFallbackLayer: Boolean = false,
                                     mappingName: Option[String] = None,
                                     magRestrictions: Option[MagRestrictions],
                                     name: Option[String],
                                     additionalAxes: Option[Seq[AdditionalAxis]])
object AnnotationLayerParameters {
  implicit val jsonFormat: OFormat[AnnotationLayerParameters] =
    Json.using[WithDefaultValues].format[AnnotationLayerParameters]
}

class AnnotationController @Inject()(
    annotationDAO: AnnotationDAO,
    annotationLayerDAO: AnnotationLayerDAO,
    taskDAO: TaskDAO,
    userDAO: UserDAO,
    organizationDAO: OrganizationDAO,
    datasetDAO: DatasetDAO,
    tracingStoreDAO: TracingStoreDAO,
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
    tracingDataSourceTemporaryStore: TracingDataSourceTemporaryStore,
    conf: WkConf,
    rpc: RPC,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with UserAwareRequestLogging
    with FoxImplicits {

  implicit val timeout: Timeout = Timeout(5 seconds)
  private val taskReopenAllowed = conf.Features.taskReopenAllowed + (10 seconds)

  def info( // Type of the annotation, one of Task, Explorational, CompoundTask, CompoundProject, CompoundTaskType
           typ: String,
           // For Task and Explorational annotations, id is an annotation id. For CompoundTask, id is a task id. For CompoundProject, id is a project id. For CompoundTaskType, id is a task type id
           id: String,
           // Timestamp in milliseconds (time at which the request is sent)
           timestamp: Long): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
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
            timeSpanService
              .logUserInteractionIfTheyArePotentialContributor(Instant(timestamp), user, annotation) // log time when a user starts working
          } else Fox.successful(())
        }
        _ = Fox.runOptional(request.identity)(user => userDAO.updateLastActivity(user._id))
        _ = request.identity.foreach { user =>
          analyticsService.track(OpenAnnotationEvent(user, annotation))
        }
      } yield Ok(js)
    }
  }

  def infoWithoutType(id: String,
                      // Timestamp in milliseconds (time at which the request is sent
                      timestamp: Long): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    log() {
      for {
        annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
        result <- info(annotation.typ.toString, id, timestamp)(request)
      } yield result

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

  def mergeWithoutType(id: String, mergedTyp: String, mergedId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
        result <- merge(annotation.typ.toString, id, mergedTyp, mergedId)(request)
      } yield result
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
        _ <- bool2Fox(isAdminOrTeamManager || (annotation.modified + taskReopenAllowed).isPast) ?~> "annotation.reopen.tooLate"
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

  def editLockedState(typ: String, id: String, isLockedByOwner: Boolean): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity)
        _ <- bool2Fox(annotation._user == request.identity._id) ?~> "annotation.isLockedByOwner.notAllowed"
        _ <- bool2Fox(annotation.typ == AnnotationType.Explorational) ?~> "annotation.isLockedByOwner.explorationalsOnly"
        _ = logger.info(
          s"Locking annotation $id, new locked state will be ${isLockedByOwner.toString}, access context: ${request.identity.toStringAnonymous}")
        _ <- annotationDAO.updateLockedState(annotation._id, isLockedByOwner) ?~> "annotation.invalid"
        updatedAnnotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
        json <- annotationService.publicWrites(updatedAnnotation, Some(request.identity)) ?~> "annotation.write.failed"
      } yield JsonOk(json, Messages("annotation.isLockedByOwner.success"))
  }

  def addAnnotationLayer(typ: String, id: String): Action[AnnotationLayerParameters] =
    sil.SecuredAction.async(validateJson[AnnotationLayerParameters]) { implicit request =>
      for {
        _ <- bool2Fox(AnnotationType.Explorational.toString == typ) ?~> "annotation.addLayer.explorationalsOnly"
        restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
        _ <- restrictions.allowUpdate(request.identity) ?~> "notAllowed" ~> FORBIDDEN
        annotation <- provider.provideAnnotation(typ, id, request.identity)
        newLayerName = request.body.name.getOrElse(AnnotationLayer.defaultNameForType(request.body.typ))
        _ <- bool2Fox(!annotation.annotationLayers.exists(_.name == newLayerName)) ?~> "annotation.addLayer.nameInUse"
        organization <- organizationDAO.findOne(request.identity._organization)
        _ <- annotationService.addAnnotationLayer(annotation, organization._id, request.body)
        updated <- provider.provideAnnotation(typ, id, request.identity)
        json <- annotationService.publicWrites(updated, Some(request.identity)) ?~> "annotation.write.failed"
      } yield JsonOk(json)
    }

  def addAnnotationLayerWithoutType(id: String): Action[AnnotationLayerParameters] =
    sil.SecuredAction.async(validateJson[AnnotationLayerParameters]) { implicit request =>
      for {
        annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
        result <- addAnnotationLayer(annotation.typ.toString, id)(request)
      } yield result
    }

  def deleteAnnotationLayer(typ: String, id: String, layerName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(AnnotationType.Explorational.toString == typ) ?~> "annotation.deleteLayer.explorationalsOnly"
        annotation <- provider.provideAnnotation(typ, id, request.identity)
        _ <- bool2Fox(annotation._user == request.identity._id) ?~> "notAllowed" ~> FORBIDDEN
        layer <- annotation.annotationLayers.find(annotationLayer => annotationLayer.name == layerName) ?~> Messages(
          "annotation.layer.notFound",
          layerName)
        _ <- bool2Fox(annotation.annotationLayers.length != 1) ?~> "annotation.deleteLayer.onlyLayer"
        _ = logger.info(
          s"Deleting annotation layer $layerName (tracing id ${layer.tracingId}, typ ${layer.typ}) for annotation $id")
        _ <- annotationService.deleteAnnotationLayer(annotation, layerName)
      } yield Ok
    }

  def deleteAnnotationLayerWithoutType(id: String, layerName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
        result <- deleteAnnotationLayer(annotation.typ.toString, id, layerName)(request)
      } yield result
    }

  def createExplorational(datasetId: String): Action[List[AnnotationLayerParameters]] =
    sil.SecuredAction.async(validateJson[List[AnnotationLayerParameters]]) { implicit request =>
      for {
        datasetIdValidated <- ObjectId.fromString(datasetId)
        dataset <- datasetDAO.findOne(datasetIdValidated) ?~> Messages("dataset.notFound", datasetIdValidated) ~> NOT_FOUND
        annotation <- annotationService.createExplorationalFor(
          request.identity,
          dataset._id,
          request.body
        ) ?~> "annotation.create.failed"
        _ = analyticsService.track(CreateAnnotationEvent(request.identity: User, annotation: Annotation))
        _ = mailchimpClient.tagUser(request.identity, MailchimpTag.HasAnnotated)
        json <- annotationService.publicWrites(annotation, Some(request.identity)) ?~> "annotation.write.failed"
      } yield JsonOk(json)
    }

  def getSandbox(datasetId: String, typ: String, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken) // users with dataset sharing token may also get a sandbox annotation
      for {
        datasetIdValidated <- ObjectId.fromString(datasetId)
        dataset <- datasetDAO.findOne(datasetIdValidated)(ctx) ?~> Messages("dataset.notFound", datasetIdValidated) ~> NOT_FOUND
        tracingType <- TracingType.fromString(typ).toFox
        _ <- bool2Fox(tracingType == TracingType.skeleton) ?~> "annotation.sandbox.skeletonOnly"
        annotation = Annotation(
          ObjectId.dummyId,
          dataset._id,
          None,
          ObjectId.dummyId,
          ObjectId.dummyId,
          List(
            AnnotationLayer(TracingIds.dummyTracingId,
                            AnnotationLayerType.Skeleton,
                            AnnotationLayer.defaultSkeletonLayerName,
                            AnnotationLayerStatistics.unknown))
        )
        json <- annotationService.publicWrites(annotation, request.identity) ?~> "annotation.write.failed"
      } yield JsonOk(json)
    }

  def makeHybrid(typ: String, id: String, fallbackLayerName: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(AnnotationType.Explorational.toString == typ) ?~> "annotation.addLayer.explorationalsOnly"
        restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
        _ <- restrictions.allowUpdate(request.identity) ?~> "notAllowed" ~> FORBIDDEN
        annotation <- provider.provideAnnotation(typ, id, request.identity)
        organization <- organizationDAO.findOne(request.identity._organization)
        _ <- annotationService.makeAnnotationHybrid(annotation, organization._id, fallbackLayerName) ?~> "annotation.makeHybrid.failed"
        updated <- provider.provideAnnotation(typ, id, request.identity)
        json <- annotationService.publicWrites(updated, Some(request.identity)) ?~> "annotation.write.failed"
      } yield JsonOk(json)
    }

  def makeHybridWithoutType(id: String, fallbackLayerName: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
        result <- makeHybrid(annotation.typ.toString, id, fallbackLayerName)(request)
      } yield result
    }

  def downsample(typ: String, id: String, tracingId: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- bool2Fox(AnnotationType.Explorational.toString == typ) ?~> "annotation.downsample.explorationalsOnly"
        restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
        _ <- restrictions.allowUpdate(request.identity) ?~> "notAllowed" ~> FORBIDDEN
        annotation <- provider.provideAnnotation(typ, id, request.identity)
        annotationLayer <- annotation.annotationLayers
          .find(_.tracingId == tracingId)
          .toFox ?~> "annotation.downsample.layerNotFound"
        _ <- annotationService.downsampleAnnotation(annotation, annotationLayer) ?~> "annotation.downsample.failed"
        updated <- provider.provideAnnotation(typ, id, request.identity)
        json <- annotationService.publicWrites(updated, Some(request.identity)) ?~> "annotation.write.failed"
      } yield JsonOk(json)
  }

  def downsampleWithoutType(id: String, tracingId: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
        result <- downsample(annotation.typ.toString, id, tracingId)(request)
      } yield result
  }

  def addSegmentIndicesToAll(parallelBatchCount: Int,
                             dryRun: Boolean,
                             skipTracings: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      {
        for {
          _ <- userService.assertIsSuperUser(request.identity._multiUser) ?~> "notAllowed" ~> FORBIDDEN
          _ = logger.info("Running migration to add segment index to all volume annotation layers...")
          skipTracingsSet = skipTracings.map(_.split(",").toSet).getOrElse(Set())
          _ = if (skipTracingsSet.nonEmpty) {
            logger.info(f"Skipping these tracings: ${skipTracingsSet.mkString(",")}")
          }
          _ = logger.info("Gathering list of volume tracings...")
          annotationLayers <- annotationLayerDAO.findAllVolumeLayers
          annotationLayersFiltered = annotationLayers.filter(l => !skipTracingsSet.contains(l.tracingId))
          totalCount = annotationLayersFiltered.length
          batches = batch(annotationLayersFiltered, parallelBatchCount)
          _ = logger.info(f"Processing $totalCount tracings in ${batches.length} batches")
          before = Instant.now
          results: Seq[List[Box[Unit]]] <- Fox.combined(batches.zipWithIndex.map {
            case (batch, index) => addSegmentIndicesToBatch(batch, index, dryRun)
          })
          failures = results.flatMap(_.filter(_.isEmpty))
          failureCount: Int = failures.length
          successCount: Int = results.map(_.count(_.isDefined)).sum
          msg = s"All done (dryRun=$dryRun)! Processed $totalCount tracings in ${batches.length} batches. Took ${Instant
            .since(before)}. $failureCount failures, $successCount successes."
          _ = if (failures.nonEmpty) {
            failures.foreach { failedBox =>
              logger.info(f"Failed: $failedBox")
            }
          }
          _ = logger.info(msg)
        } yield JsonOk(msg)
      }
    }

  private def addSegmentIndicesToBatch(annotationLayerBatch: List[AnnotationLayer], batchIndex: Int, dryRun: Boolean)(
      implicit ec: ExecutionContext) = {
    var processedCount = 0
    for {
      tracingStore <- tracingStoreDAO.findFirst(GlobalAccessContext) ?~> "tracingStore.notFound"
      client = new WKRemoteTracingStoreClient(tracingStore, null, rpc, tracingDataSourceTemporaryStore)
      batchCount = annotationLayerBatch.length
      results <- Fox.serialSequenceBox(annotationLayerBatch) { annotationLayer =>
        processedCount += 1
        logger.info(
          f"Processing tracing ${annotationLayer.tracingId}. $processedCount of $batchCount in batch $batchIndex (${percent(processedCount, batchCount)})...")
        client.addSegmentIndex(annotationLayer.tracingId, dryRun) ?~> s"add segment index failed for ${annotationLayer.tracingId}"
      }
      _ = logger.info(f"Batch $batchIndex is done. Processed ${annotationLayerBatch.length} tracings.")
    } yield results
  }

  private def batch[T](allItems: List[T], batchCount: Int): List[List[T]] = {
    val batchSize: Int = Math.max(Math.min(allItems.length / batchCount, allItems.length), 1)
    allItems.grouped(batchSize).toList
  }

  private def percent(done: Int, pending: Int) = {
    val value = done.toDouble / pending.toDouble * 100
    f"$value%1.1f %%"
  }

  private def finishAnnotation(typ: String, id: String, issuingUser: User, timestamp: Instant)(
      implicit ctx: DBAccessContext): Fox[(Annotation, String)] =
    for {
      annotation <- provider.provideAnnotation(typ, id, issuingUser) ~> NOT_FOUND
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
      message <- annotationService.finish(annotation, issuingUser, restrictions) ?~> "annotation.finish.failed"
      updated <- provider.provideAnnotation(typ, id, issuingUser)
      _ <- timeSpanService.logUserInteractionIfTheyArePotentialContributor(timestamp, issuingUser, annotation) // log time on tracing end
    } yield (updated, message)

  def finish(typ: String, id: String, timestamp: Long): Action[AnyContent] = sil.SecuredAction.async {
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
          val results = Fox.serialSequence(annotationIds.value.toList) { jsValue =>
            jsValue.asOpt[String].toFox.flatMap(id => finishAnnotation(typ, id, request.identity, Instant(timestamp)))
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
        visibility = (request.body \ "visibility").asOpt[AnnotationVisibility.Value]
        _ <- if (visibility.contains(AnnotationVisibility.Private))
          annotationService.updateTeamsForSharedAnnotation(annotation._id, List.empty)
        else Fox.successful(())
        tags = (request.body \ "tags").asOpt[List[String]]
        viewConfiguration = (request.body \ "viewConfiguration").asOpt[JsObject]
        _ <- Fox.runOptional(name)(annotationDAO.updateName(annotation._id, _)) ?~> "annotation.edit.failed"
        _ <- Fox
          .runOptional(description)(annotationDAO.updateDescription(annotation._id, _)) ?~> "annotation.edit.failed"
        _ <- Fox.runOptional(visibility)(annotationDAO.updateVisibility(annotation._id, _)) ?~> "annotation.edit.failed"
        _ <- Fox.runOptional(tags)(annotationDAO.updateTags(annotation._id, _)) ?~> "annotation.edit.failed"
        _ <- Fox
          .runOptional(viewConfiguration)(vc => annotationDAO.updateViewConfiguration(annotation._id, Some(vc))) ?~> "annotation.edit.failed"
      } yield JsonOk(Messages("annotation.edit.success"))
  }

  def editAnnotationLayer(typ: String, id: String, tracingId: String): Action[JsValue] =
    sil.SecuredAction.async(parse.json) { implicit request =>
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity) ~> NOT_FOUND
        restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
        _ <- restrictions.allowUpdate(request.identity) ?~> "notAllowed" ~> FORBIDDEN
        newLayerName = (request.body \ "name").as[String]
        _ <- annotationLayerDAO.updateName(annotation._id, tracingId, newLayerName) ?~> "annotation.edit.failed"
      } yield JsonOk(Messages("annotation.edit.success"))
    }

  def annotationsForTask(taskId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        taskIdValidated <- ObjectId.fromString(taskId)
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

  def cancelWithoutType(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
      result <- cancel(annotation.typ.toString, id)(request)
    } yield result
  }

  def transfer(typ: String, id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound" ~> NOT_FOUND
      _ <- restrictions.allowFinish(request.identity) ?~> "notAllowed" ~> FORBIDDEN
      newUserId <- (request.body \ "userId").asOpt[String].toFox ?~> "user.id.notFound" ~> NOT_FOUND
      newUserIdValidated <- ObjectId.fromString(newUserId)
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

  def getSharedTeams(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity)
      _ <- bool2Fox(annotation._user == request.identity._id) ?~> "notAllowed" ~> FORBIDDEN
      teams <- teamDAO.findSharedTeamsForAnnotation(annotation._id)
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
          teamIdsValidated <- Fox.serialCombined(teams)(ObjectId.fromString)
          _ <- Fox.serialCombined(teamIdsValidated)(teamDAO.findOne(_)) ?~> "updateSharedTeams.failed.accessingTeam"
          _ <- annotationService.updateTeamsForSharedAnnotation(annotation._id, teamIdsValidated)
        } yield Ok(Json.toJson(teamIdsValidated))
      }
  }

  def updateOthersMayEdit(typ: String, id: String, othersMayEdit: Boolean): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity)
        _ <- bool2Fox(annotation.typ == AnnotationType.Explorational || annotation.typ == AnnotationType.Task) ?~> "annotation.othersMayEdit.onlyExplorationalOrTask"
        _ <- bool2Fox(annotation._user == request.identity._id) ?~> "notAllowed" ~> FORBIDDEN
        _ <- annotationDAO.updateOthersMayEdit(annotation._id, othersMayEdit)
      } yield Ok(Json.toJson(othersMayEdit))
    }

  private def duplicateAnnotation(annotation: Annotation, user: User)(implicit ctx: DBAccessContext,
                                                                      m: MessagesProvider): Fox[Annotation] =
    for {
      // GlobalAccessContext is allowed here because the user was already allowed to see the annotation
      dataset <- datasetDAO.findOne(annotation._dataset)(GlobalAccessContext) ?~> "dataset.notFoundForAnnotation" ~> NOT_FOUND
      _ <- bool2Fox(dataset.isUsable) ?~> Messages("dataset.notImported", dataset.name)
      dataSource <- if (annotation._task.isDefined)
        datasetService.dataSourceFor(dataset).flatMap(_.toUsable).map(Some(_))
      else Fox.successful(None)
      tracingStoreClient <- tracingStoreService.clientFor(dataset)
      newAnnotationLayers <- Fox.serialCombined(annotation.annotationLayers) { annotationLayer =>
        duplicateAnnotationLayer(annotationLayer,
                                 annotation._task.isDefined,
                                 dataSource.map(_.boundingBox),
                                 tracingStoreClient)
      }
      clonedAnnotation <- annotationService.createFrom(user,
                                                       dataset,
                                                       newAnnotationLayers,
                                                       AnnotationType.Explorational,
                                                       None,
                                                       annotation.description) ?~> Messages("annotation.create.failed")
    } yield clonedAnnotation

  private def duplicateAnnotationLayer(annotationLayer: AnnotationLayer,
                                       isFromTask: Boolean,
                                       datasetBoundingBox: Option[BoundingBox],
                                       tracingStoreClient: WKRemoteTracingStoreClient): Fox[AnnotationLayer] =
    for {

      newTracingId <- if (annotationLayer.typ == AnnotationLayerType.Skeleton) {
        tracingStoreClient.duplicateSkeletonTracing(annotationLayer.tracingId, None, isFromTask) ?~> "Failed to duplicate skeleton tracing."
      } else {
        tracingStoreClient.duplicateVolumeTracing(annotationLayer.tracingId, isFromTask, datasetBoundingBox) ?~> "Failed to duplicate volume tracing."
      }
    } yield annotationLayer.copy(tracingId = newTracingId)

  def tryAcquiringAnnotationMutex(id: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      logTime(slackNotificationService.noticeSlowRequest, durationThreshold = 1 second) {
        for {
          idValidated <- ObjectId.fromString(id)
          annotation <- provider.provideAnnotation(id, request.identity) ~> NOT_FOUND
          _ <- bool2Fox(annotation.othersMayEdit) ?~> "notAllowed" ~> FORBIDDEN
          restrictions <- provider.restrictionsFor(AnnotationIdentifier(annotation.typ, idValidated)) ?~> "restrictions.notFound" ~> NOT_FOUND
          _ <- restrictions.allowUpdate(request.identity) ?~> "notAllowed" ~> FORBIDDEN
          mutexResult <- annotationMutexService.tryAcquiringAnnotationMutex(annotation._id, request.identity._id) ?~> "annotation.mutex.failed"
          resultJson <- annotationMutexService.publicWrites(mutexResult)
        } yield Ok(resultJson)
      }
    }

}
