package models.task

import java.io.File

import com.mohiva.play.silhouette.api.actions.SecuredRequest
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.tracingstore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings.{ProtoGeometryImplicits, TracingType}
import com.scalableminds.webknossos.tracingstore.tracings.volume.ResolutionRestrictions
import javax.inject.Inject
import models.annotation.{
  Annotation,
  AnnotationDAO,
  AnnotationService,
  AnnotationState,
  AnnotationType,
  TracingStoreRpcClient,
  TracingStoreService
}
import models.binary.{DataSet, DataSetDAO}
import models.project.{Project, ProjectDAO}
import models.team.{Team, TeamDAO}
import models.user.{UserService, UserTeamRolesDAO}
import net.liftweb.common.{Box, Empty, Failure, Full}
import oxalis.security.WkEnv
import oxalis.telemetry.SlackNotificationService.SlackNotificationService
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsObject, Json}
import utils.ObjectId

import scala.concurrent.ExecutionContext

class TaskCreationService @Inject()(taskTypeService: TaskTypeService,
                                    taskTypeDAO: TaskTypeDAO,
                                    annotationService: AnnotationService,
                                    taskDAO: TaskDAO,
                                    taskService: TaskService,
                                    userService: UserService,
                                    teamDAO: TeamDAO,
                                    userTeamRolesDAO: UserTeamRolesDAO,
                                    slackNotificationService: SlackNotificationService,
                                    projectDAO: ProjectDAO,
                                    annotationDAO: AnnotationDAO,
                                    scriptDAO: ScriptDAO,
                                    dataSetDAO: DataSetDAO,
                                    tracingStoreService: TracingStoreService,
)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with ProtoGeometryImplicits {

  def assertBatchLimit(batchSize: Int, taskTypeIds: List[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      isVolumeOrHybrid <- taskTypeService.containsVolumeOrHybridTaskType(taskTypeIds.toSet.toList)
      batchLimit = if (isVolumeOrHybrid) 100 else 1000
      _ <- bool2Fox(batchSize <= batchLimit) ?~> "task.create.limitExceeded"
    } yield ()

  // Used in create (without files) in case of base annotation
  def duplicateAllBaseTracings(taskParametersList: List[TaskParameters], organizationId: ObjectId)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[TaskParameters]] =
    Fox.serialCombined(taskParametersList)(
      params =>
        Fox
          .runOptional(params.baseAnnotation)(duplicateBaseTracings(_, params, organizationId))
          .map(baseAnnotation => params.copy(baseAnnotation = baseAnnotation)))

  // Used in create (without files) in case of base annotation
  private def duplicateBaseTracings(
      baseAnnotation: BaseAnnotation,
      taskParameters: TaskParameters,
      organizationId: ObjectId)(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[BaseAnnotation] =
    for {
      taskTypeIdValidated <- ObjectId.parse(taskParameters.taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
      dataSet <- dataSetDAO.findOneByNameAndOrganization(taskParameters.dataSet, organizationId)
      baseAnnotationIdValidated <- ObjectId.parse(baseAnnotation.baseId)
      annotation <- resolveBaseAnnotationId(baseAnnotationIdValidated)
      tracingStoreClient <- tracingStoreService.clientFor(dataSet)
      newSkeletonId <- if (taskType.tracingType == TracingType.skeleton || taskType.tracingType == TracingType.hybrid)
        duplicateOrCreateSkeletonBase(annotation, taskParameters, tracingStoreClient).map(Some(_))
      else Fox.successful(None)
      newVolumeId <- if (taskType.tracingType == TracingType.volume || taskType.tracingType == TracingType.hybrid)
        duplicateOrCreateVolumeBase(annotation,
                                    taskParameters,
                                    tracingStoreClient,
                                    organizationId,
                                    taskType.settings.resolutionRestrictions).map(Some(_))
      else Fox.successful(None)
    } yield BaseAnnotation(baseAnnotationIdValidated.id, newSkeletonId, newVolumeId)

  // Used in create (without files) in case of base annotation
  private def resolveBaseAnnotationId(annotationOrTaskId: ObjectId)(implicit ctx: DBAccessContext): Fox[Annotation] =
    annotationDAO
      .findOne(annotationOrTaskId)
      .futureBox
      .map {
        case Full(value) => Fox.successful(value)
        case _           => resolveBaseTaskId(annotationOrTaskId)
      }
      .toFox
      .flatten

  // Used in create (without files) in case of base annotation
  @SuppressWarnings(Array("TraversableHead")) // We check if nonCancelledTaskAnnotations are empty before so head always works
  private def resolveBaseTaskId(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[Annotation] =
    (for {
      task <- taskDAO.findOne(taskId)
      annotations <- annotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.Task)
    } yield {
      val nonCancelledTaskAnnotations = annotations.filter(_.state != AnnotationState.Cancelled)
      if (task.totalInstances == 1 && task.openInstances == 0 &&
          nonCancelledTaskAnnotations.nonEmpty &&
          nonCancelledTaskAnnotations.head.state == AnnotationState.Finished)
        Fox.successful(nonCancelledTaskAnnotations.head)
      else Fox.failure("task.notOneAnnotation")
    }).flatten

  // Used in create (without files) in case of base annotation
  private def duplicateOrCreateSkeletonBase(annotation: Annotation,
                                            params: TaskParameters,
                                            tracingStoreClient: TracingStoreRpcClient): Fox[String] =
    annotation.skeletonTracingId
      .map(id => tracingStoreClient.duplicateSkeletonTracing(id))
      .getOrElse(
        tracingStoreClient.saveSkeletonTracing(
          annotationService.createSkeletonTracingBase(
            params.dataSet,
            params.boundingBox,
            params.editPosition,
            params.editRotation
          )))

  // Used in create (without files) in case of base annotation
  private def duplicateOrCreateVolumeBase(
      annotation: Annotation,
      params: TaskParameters,
      tracingStoreClient: TracingStoreRpcClient,
      organizationId: ObjectId,
      resolutionRestrictions: ResolutionRestrictions)(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[String] =
    annotation.volumeTracingId
      .map(id => tracingStoreClient.duplicateVolumeTracing(id, resolutionRestrictions = resolutionRestrictions))
      .getOrElse(
        annotationService
          .createVolumeTracingBase(
            params.dataSet,
            organizationId,
            params.boundingBox,
            params.editPosition,
            params.editRotation,
            volumeShowFallbackLayer = false,
            resolutionRestrictions = resolutionRestrictions
          )
          .flatMap(tracingStoreClient.saveVolumeTracing(_, resolutionRestrictions = resolutionRestrictions)))

  // Used in create (without files). Skipped in case of base annotation
  def createTaskSkeletonTracingBases(paramsList: List[TaskParameters])(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[Option[SkeletonTracing]]] =
    Fox.serialCombined(paramsList) { params =>
      for {
        taskTypeIdValidated <- ObjectId.parse(params.taskTypeId) ?~> "taskType.id.invalid"
        taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
        skeletonTracingOpt = if ((taskType.tracingType == TracingType.skeleton || taskType.tracingType == TracingType.hybrid) && params.baseAnnotation.isEmpty) {
          Some(
            annotationService.createSkeletonTracingBase(
              params.dataSet,
              params.boundingBox,
              params.editPosition,
              params.editRotation
            ))
        } else None
      } yield skeletonTracingOpt
    }

  // Used in create (without files). Skipped in case of base annotation
  def createTaskVolumeTracingBases(paramsList: List[TaskParameters], organizationId: ObjectId)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[Option[(VolumeTracing, Option[File])]]] =
    Fox.serialCombined(paramsList) { params =>
      for {
        taskTypeIdValidated <- ObjectId.parse(params.taskTypeId) ?~> "taskType.id.invalid"
        taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
        volumeTracingOpt <- if ((taskType.tracingType == TracingType.volume || taskType.tracingType == TracingType.hybrid) && params.baseAnnotation.isEmpty) {
          annotationService
            .createVolumeTracingBase(
              params.dataSet,
              organizationId,
              params.boundingBox,
              params.editPosition,
              params.editRotation,
              volumeShowFallbackLayer = false,
              resolutionRestrictions = taskType.settings.resolutionRestrictions
            )
            .map(v => Some((v, None)))
        } else Fox.successful(None)
      } yield volumeTracingOpt
    }

  // Used in createFromFiles. Called once per requested task
  def buildFullParamsFromFiles(nmlFormParams: NmlTaskParameters,
                               skeletonTracing: Box[SkeletonTracing],
                               volumeTracing: Box[VolumeTracing],
                               fileName: Box[String],
                               description: Box[Option[String]])(implicit m: MessagesProvider): Box[TaskParameters] = {
    val paramBox: Box[(Option[BoundingBox], String, Point3D, Vector3D)] = skeletonTracing match {
      case Full(tracing) => Full((tracing.boundingBox, tracing.dataSetName, tracing.editPosition, tracing.editRotation))
      case f: Failure    => f
      case Empty =>
        volumeTracing match {
          case Full(tracing) =>
            Full((Some(tracing.boundingBox), tracing.dataSetName, tracing.editPosition, tracing.editRotation))
          case f: Failure => f
          case Empty      => Failure(Messages("task.create.needsEitherSkeletonOrVolume"))
        }
    }

    paramBox map { params =>
      val parsedNmlTracingBoundingBox = params._1.map(b => BoundingBox(b.topLeft, b.width, b.height, b.depth))
      val bbox = if (nmlFormParams.boundingBox.isDefined) nmlFormParams.boundingBox else parsedNmlTracingBoundingBox
      TaskParameters(
        nmlFormParams.taskTypeId,
        nmlFormParams.neededExperience,
        nmlFormParams.openInstances,
        nmlFormParams.projectName,
        nmlFormParams.scriptId,
        bbox,
        params._2,
        params._3,
        params._4,
        fileName,
        description.toOption.flatten,
        None
      )
    }
  }

  // used in createFromFiles route
  def fillInMissingTracingBases(skeletonBaseOpts: List[Box[SkeletonTracing]],
                                volumeBaseOpts: List[Box[(VolumeTracing, Option[File])]],
                                fullParams: List[Box[TaskParameters]],
                                taskType: TaskType,
                                organizationId: ObjectId)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[(List[Box[SkeletonTracing]], List[Box[(VolumeTracing, Option[File])]])] =
    if (taskType.tracingType == TracingType.skeleton) {
      Fox.successful(
        skeletonBaseOpts
          .zip(volumeBaseOpts)
          .map {
            case (skeletonTracingBox, volumeTracingBox) =>
              volumeTracingBox match {
                case Full(_) => (Failure(Messages("taskType.mismatch", "skeleton", "volume")), Empty)
                case _       => (skeletonTracingBox, Empty)
              }
          }
          .unzip)
    } else if (taskType.tracingType == TracingType.volume) {
      Fox.successful(
        skeletonBaseOpts
          .zip(volumeBaseOpts)
          .map {
            case (skeletonTracingBox, volumeTracingBox) =>
              skeletonTracingBox match {
                case Full(_) => (Empty, Failure(Messages("taskType.mismatch", "volume", "skeleton")))
                case _       => (Empty, volumeTracingBox)
              }
          }
          .unzip)
    } else
      Fox
        .serialCombined((fullParams, skeletonBaseOpts, volumeBaseOpts).zipped.toList) {
          case (paramBox, skeleton, volume) =>
            paramBox match {
              case Full(params) =>
                val skeletonBox = Full(
                  skeleton.openOr(
                    annotationService.createSkeletonTracingBase(params.dataSet,
                                                                params.boundingBox,
                                                                params.editPosition,
                                                                params.editRotation)))
                val volumeFox = volume
                  .map(Fox.successful(_))
                  .openOr(
                    annotationService
                      .createVolumeTracingBase(
                        params.dataSet,
                        organizationId,
                        params.boundingBox,
                        params.editPosition,
                        params.editRotation,
                        volumeShowFallbackLayer = false,
                        resolutionRestrictions = taskType.settings.resolutionRestrictions
                      )
                      .map(v => (v, None)))

                volumeFox.map(v => (skeletonBox, Full(v)))
              case f: Failure => Fox.failure(f.msg, Empty, f.chain)
              case _          => Fox.failure("")
            }
        }
        .map(_.unzip)

  // used in both task creation routes
  def createTasks(
      requestedTasks: List[Box[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])]])(
      implicit request: SecuredRequest[WkEnv, _],
      mp: MessagesProvider,
      ctx: DBAccessContext): Fox[TaskCreationResult] = {
    val fullTasks = requestedTasks.flatten
    if (fullTasks.isEmpty) {
      // if there is no nonempty task, we directly return all of the errors
      return Fox.successful(
        TaskCreationResult.fromBoxResults(requestedTasks.map(_.map(_ => Json.obj())), List.empty[String]))
    }

    def assertEachHasEitherSkeletonOrVolume: Fox[Boolean] =
      bool2Fox(fullTasks.forall(tuple => tuple._1.baseAnnotation.isDefined || tuple._2.isDefined || tuple._3.isDefined))

    def assertAllOnSameDataset(firstDatasetName: String): Fox[String] = {
      @scala.annotation.tailrec
      def allOnSameDatasetIter(
          requestedTasksRest: List[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])],
          dataSetName: String): Boolean =
        requestedTasksRest match {
          case List()       => true
          case head :: tail => head._1.dataSet == dataSetName && allOnSameDatasetIter(tail, dataSetName)
        }

      if (allOnSameDatasetIter(fullTasks, firstDatasetName))
        Fox.successful(firstDatasetName)
      else
        Fox.failure(Messages("task.notOnSameDataSet"))
    }

    for {
      _ <- assertEachHasEitherSkeletonOrVolume ?~> "task.create.needsEitherSkeletonOrVolume"
      firstDatasetName <- fullTasks.headOption.map(_._1.dataSet).toFox
      _ <- assertAllOnSameDataset(firstDatasetName)
      dataSet <- dataSetDAO.findOneByNameAndOrganization(firstDatasetName, request.identity._organization) ?~> Messages(
        "dataSet.notFound",
        firstDatasetName)
      _ = if (fullTasks.exists(task => task._1.baseAnnotation.isDefined))
        slackNotificationService.noticeBaseAnnotationTaskCreation(fullTasks.map(_._1.taskTypeId).distinct,
                                                                  fullTasks.count(_._1.baseAnnotation.isDefined))
      tracingStoreClient <- tracingStoreService.clientFor(dataSet)
      savedSkeletonTracingIds: List[Box[Option[String]]] <- tracingStoreClient.saveSkeletonTracings(
        SkeletonTracings(requestedTasks.map(taskTuple => SkeletonTracingOpt(taskTuple.map(_._2).openOr(None)))))
      skeletonTracingIds: List[Box[Option[String]]] = savedSkeletonTracingIds.zip(requestedTasks).map {
        case (savedId, base) =>
          base match {
            case f: Failure => f
            case _          => savedId
          }
      }
      volumeTracingIds: List[Box[Option[String]]] <- Fox.sequence(
        requestedTasks.map(requestedTask => saveVolumeTracingIfPresent(requestedTask, tracingStoreClient)))
      skeletonTracingsIdsMerged = mergeTracingIds((requestedTasks.map(_.map(_._1)), skeletonTracingIds).zipped.toList,
                                                  isSkeletonId = true)
      volumeTracingsIdsMerged = mergeTracingIds((requestedTasks.map(_.map(_._1)), volumeTracingIds).zipped.toList,
                                                isSkeletonId = false)
      requestedTasksWithTracingIds = (requestedTasks, skeletonTracingsIdsMerged, volumeTracingsIdsMerged).zipped.toList
      taskObjects: List[Fox[Task]] = requestedTasksWithTracingIds.map(r =>
        createTaskWithoutAnnotationBase(r._1.map(_._1), r._2, r._3))
      zipped = (requestedTasks, skeletonTracingsIdsMerged.zip(volumeTracingsIdsMerged), taskObjects).zipped.toList
      createAnnotationBaseResults: List[Fox[Unit]] = zipped.map(
        tuple =>
          annotationService.createAnnotationBase(
            taskFox = tuple._3,
            request.identity._id,
            skeletonTracingIdBox = tuple._2._1,
            volumeTracingIdBox = tuple._2._2,
            dataSet._id,
            description = tuple._1.map(_._1.description).openOr(None)
        ))
      warnings <- warnIfTeamHasNoAccess(fullTasks.map(_._1), dataSet)
      zippedTasksAndAnnotations = taskObjects zip createAnnotationBaseResults
      taskJsons = zippedTasksAndAnnotations.map(tuple => taskToJsonFoxed(tuple._1, tuple._2))
      result <- TaskCreationResult.fromTaskJsFoxes(taskJsons, warnings)
    } yield result
  }

  private def mergeTracingIds(list: List[(Box[TaskParameters], Box[Option[String]])],
                              isSkeletonId: Boolean): List[Box[Option[String]]] =
    list.map {
      case (paramBox, idBox) =>
        paramBox match {
          case Full(params) =>
            params.baseAnnotation.map(bA => Full(if (isSkeletonId) bA.skeletonId else bA.volumeId)).getOrElse(idBox)
          case _ => idBox
        }
    }

  private def saveVolumeTracingIfPresent(
      requestedTaskBox: Box[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])],
      tracingStoreClient: TracingStoreRpcClient)(implicit ctx: DBAccessContext): Fox[Option[String]] =
    requestedTaskBox.map { tuple =>
      (tuple._1, tuple._3)
    } match {
      case Full((params: TaskParameters, Some((tracing, initialFile)))) =>
        for {
          taskTypeIdValidated <- ObjectId.parse(params.taskTypeId) ?~> "taskType.id.invalid"
          taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
          saveResult <- tracingStoreClient
            .saveVolumeTracing(tracing, initialFile, resolutionRestrictions = taskType.settings.resolutionRestrictions)
            .map(Some(_))
        } yield saveResult
      case f: Failure => box2Fox(f)
      case _          => Fox.successful(None)
    }

  private def warnIfTeamHasNoAccess(requestedTasks: List[TaskParameters], dataSet: DataSet)(
      implicit ctx: DBAccessContext): Fox[List[String]] = {
    val projectNames = requestedTasks.map(_.projectName).distinct
    for {
      projects: List[Project] <- Fox.serialCombined(projectNames)(projectDAO.findOneByName(_))
      dataSetTeams <- teamDAO.findAllForDataSet(dataSet._id)
      noAccessTeamIds = projects.map(_._team).diff(dataSetTeams.map(_._id))
      noAccessTeamIdsTransitive <- Fox.serialCombined(noAccessTeamIds)(id =>
        filterOutTransitiveSubteam(id, dataSetTeams.map(_._id)))
      noAccessTeams: List[Team] <- Fox.serialCombined(noAccessTeamIdsTransitive.flatten)(id => teamDAO.findOne(id))
      warnings = noAccessTeams.map(team =>
        s"Project team “${team.name}” has no read permission to dataset “${dataSet.name}”.")
    } yield warnings
  }

  private def filterOutTransitiveSubteam(subteamId: ObjectId, dataSetTeams: List[ObjectId]): Fox[Option[ObjectId]] =
    if (dataSetTeams.isEmpty) Fox.successful(Some(subteamId))
    else {
      for {
        memberDifference <- userTeamRolesDAO.findMemberDifference(subteamId, dataSetTeams)
      } yield if (memberDifference.isEmpty) None else Some(subteamId)
    }

  private def validateScript(scriptIdOpt: Option[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    scriptIdOpt match {
      case Some(scriptId) =>
        for {
          scriptIdValidated <- ObjectId.parse(scriptId)
          _ <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound"
        } yield ()
      case _ => Fox.successful(())
    }

  private def createTaskWithoutAnnotationBase(paramBox: Box[TaskParameters],
                                              skeletonTracingIdBox: Box[Option[String]],
                                              volumeTracingIdBox: Box[Option[String]])(
      implicit request: SecuredRequest[WkEnv, _],
      ctx: DBAccessContext,
      mp: MessagesProvider): Fox[Task] =
    for {
      params <- paramBox.toFox
      skeletonIdOpt <- skeletonTracingIdBox.toFox
      volumeIdOpt <- volumeTracingIdBox.toFox
      _ <- bool2Fox(skeletonIdOpt.isDefined || volumeIdOpt.isDefined) ?~> "task.create.needsEitherSkeletonOrVolume"
      taskTypeIdValidated <- ObjectId.parse(params.taskTypeId)
      project <- projectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- validateScript(params.scriptId) ?~> "script.invalid"
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
      task = Task(
        ObjectId.generate,
        project._id,
        params.scriptId.map(ObjectId(_)),
        taskTypeIdValidated,
        params.neededExperience,
        params.openInstances, //all instances are open at this time
        params.openInstances,
        tracingTime = None,
        boundingBox = params.boundingBox.flatMap { box =>
          if (box.isEmpty) None else Some(box)
        },
        editPosition = params.editPosition,
        editRotation = params.editRotation,
        creationInfo = params.creationInfo
      )
      _ <- taskDAO.insertOne(task)
    } yield task

  private def taskToJsonFoxed(taskFox: Fox[Task], otherFox: Fox[Unit])(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      _ <- otherFox
      task <- taskFox
      js <- taskService.publicWrites(task)
    } yield js
}
