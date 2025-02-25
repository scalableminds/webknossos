package models.task

import collections.SequenceUtils

import java.io.File
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.tracings.{TracingId, TracingType}
import com.scalableminds.webknossos.tracingstore.tracings.volume.MagRestrictions

import javax.inject.Inject
import models.annotation.nml.NmlResults.TracingBoxContainer
import models.annotation._
import models.dataset.{Dataset, DatasetDAO, DatasetService}
import models.project.{Project, ProjectDAO}
import models.team.{Team, TeamDAO, TeamService}
import models.user.{User, UserDAO, UserExperiencesDAO, UserService}
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsObject, Json}
import telemetry.SlackNotificationService
import com.scalableminds.util.objectid.ObjectId
import models.organization.OrganizationDAO
import play.api.http.Status.FORBIDDEN
import spire.std.map

import scala.concurrent.ExecutionContext

class TaskCreationService @Inject()(taskTypeService: TaskTypeService,
                                    taskTypeDAO: TaskTypeDAO,
                                    annotationService: AnnotationService,
                                    taskDAO: TaskDAO,
                                    organizationDAO: OrganizationDAO,
                                    taskService: TaskService,
                                    userService: UserService,
                                    teamDAO: TeamDAO,
                                    teamService: TeamService,
                                    userDAO: UserDAO,
                                    slackNotificationService: SlackNotificationService,
                                    projectDAO: ProjectDAO,
                                    annotationDAO: AnnotationDAO,
                                    userExperiencesDAO: UserExperiencesDAO,
                                    scriptDAO: ScriptDAO,
                                    datasetDAO: DatasetDAO,
                                    datasetService: DatasetService,
                                    tracingStoreService: TracingStoreService,
)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with ProtoGeometryImplicits {

  def assertBatchLimit(batchSize: Int, taskType: TaskType)(implicit m: MessagesProvider): Fox[Unit] = {
    val batchLimit =
      if (taskType.tracingType == TracingType.volume || taskType.tracingType == TracingType.hybrid)
        100
      else
        1000
    bool2Fox(batchSize <= batchLimit) ?~> Messages("task.create.limitExceeded", batchLimit)
  }

  // Used in create (without files) in case of base annotation
  // Note that the requested task’s tracingType is always fulfilled here,
  // either by duplicating the base annotation’s tracings or creating new tracings
  def createTracingsFromBaseAnnotations(taskParametersList: List[TaskParameters], taskType: TaskType, dataset: Dataset)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[TaskParameters]] =
    Fox.serialCombined(taskParametersList)(
      params =>
        Fox
          .runOptional(params.baseAnnotation)(createTracingsFromBaseAnnotation(_, params, taskType, dataset))
          .map(baseAnnotation => params.copy(baseAnnotation = baseAnnotation)))

  // Used in create (without files) in case of base annotation
  private def createTracingsFromBaseAnnotation(
      baseAnnotation: BaseAnnotation,
      taskParameters: TaskParameters,
      taskType: TaskType,
      dataset: Dataset)(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[BaseAnnotation] =
    for {
      baseAnnotationIdValidated <- ObjectId.fromString(baseAnnotation.baseId)
      annotation <- resolveBaseAnnotationId(baseAnnotationIdValidated)
      tracingStoreClient <- tracingStoreService.clientFor(dataset)
      _ <- Fox.runOptional(taskParameters.newSkeletonTracingId)(_ =>
        duplicateOrCreateSkeletonBase(annotation, taskParameters, tracingStoreClient))
      _ <- Fox.runOptional(taskParameters.newVolumeTracingId)(_ =>
        duplicateOrCreateVolumeBase(annotation, taskParameters, tracingStoreClient, taskType.settings.magRestrictions))
    } yield
      BaseAnnotation(baseAnnotationIdValidated.id,
                     taskParameters.newSkeletonTracingId,
                     taskParameters.newVolumeTracingId)

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
      if (task.totalInstances == 1 && task.pendingInstances == 0 &&
          nonCancelledTaskAnnotations.nonEmpty &&
          nonCancelledTaskAnnotations.head.state == AnnotationState.Finished)
        Fox.successful(nonCancelledTaskAnnotations.head)
      else Fox.failure("task.create.notOneAnnotation")
    }).flatten

  // Used in create (without files) in case of base annotation
  private def duplicateOrCreateSkeletonBase(
      baseAnnotation: Annotation,
      params: TaskParameters,
      tracingStoreClient: WKRemoteTracingStoreClient)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      baseSkeletonTracingIdOpt <- baseAnnotation.skeletonTracingId
      newAnnotationId <- params.newAnnotationId.toFox
      newSkeletonId <- params.newSkeletonTracingId.toFox
      _ <- baseSkeletonTracingIdOpt match {
        case Some(id) =>
          tracingStoreClient.duplicateSkeletonTracing(
            id,
            newAnnotationId,
            newSkeletonId,
            editPosition = Some(params.editPosition),
            editRotation = Some(params.editRotation),
            boundingBox = params.boundingBox
          )
        case None =>
          for {
            skeleton <- annotationService.createSkeletonTracingBase(
              params.datasetId,
              params.boundingBox,
              params.editPosition,
              params.editRotation
            )
            _ <- tracingStoreClient.saveSkeletonTracing(skeleton, newSkeletonId)
          } yield ()
      }
    } yield ()

  // Used in create (without files) in case of base annotation
  private def duplicateOrCreateVolumeBase(
      baseAnnotation: Annotation,
      params: TaskParameters,
      tracingStoreClient: WKRemoteTracingStoreClient,
      magRestrictions: MagRestrictions)(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[Unit] =
    for {
      volumeTracingOpt <- baseAnnotation.volumeTracingId
      newVolumeTracingId <- volumeTracingOpt
        .map(
          id =>
            tracingStoreClient.duplicateVolumeTracing(id,
                                                      editPosition = Some(params.editPosition),
                                                      editRotation = Some(params.editRotation),
                                                      magRestrictions = magRestrictions))
        .getOrElse(
          annotationService
            .createVolumeTracingBase(
              params.datasetId,
              params.boundingBox,
              params.editPosition,
              params.editRotation,
              volumeShowFallbackLayer = false,
              magRestrictions = magRestrictions
            )
            .flatMap(tracingStoreClient.saveVolumeTracing(ObjectId.generate, _, magRestrictions = magRestrictions))) // TODO pass annotation id
    } yield newVolumeTracingId

  // Used in create (without files). If base annotations were used, this does nothing.
  def createTaskSkeletonTracingBases(paramsList: List[TaskParameters], dataset: Dataset)(
      implicit ctx: DBAccessContext): Fox[List[Option[SkeletonTracing]]] =
    Fox.serialCombined(paramsList) { params =>
      Fox.runIf(params.baseAnnotation.isEmpty && params.newSkeletonTracingId.isDefined) {
        annotationService.createSkeletonTracingBase(
          params.datasetId, // TODO pass dataset directly?
          params.boundingBox,
          params.editPosition,
          params.editRotation
        )
      }
    }

  // Used in create (without files). If base annotations were used, this does nothing.
  def createTaskVolumeTracingBases(paramsList: List[TaskParameters], taskType: TaskType)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[Option[(VolumeTracing, Option[File])]]] =
    Fox.serialCombined(paramsList) { params =>
      for {
        volumeTracingOpt <- if (params.newVolumeTracingId.isDefined && params.baseAnnotation.isEmpty) {
          annotationService
            .createVolumeTracingBase(
              params.datasetId,
              params.boundingBox,
              params.editPosition,
              params.editRotation,
              volumeShowFallbackLayer = false,
              magRestrictions = taskType.settings.magRestrictions
            )
            .map(v => Some((v, None)))
        } else Fox.successful(None)
      } yield volumeTracingOpt
    }

  def buildFullParamsFromFiles(params: NmlTaskParameters, extractedTracingBoxes: List[TracingBoxContainer])(
      implicit m: MessagesProvider): List[Box[TaskParameters]] =
    extractedTracingBoxes.map { boxContainer =>
      buildFullParamsFromFilesForSingleTask(params,
                                            boxContainer.skeleton,
                                            boxContainer.volume.map(_._1),
                                            boxContainer.datasetId,
                                            boxContainer.fileName,
                                            boxContainer.description)
    }

  // Used in createFromFiles. For all volume tracings that have an empty bounding box, reset it to the dataset bounding box
  def addVolumeFallbackBoundingBoxes(tracingBoxes: List[TracingBoxContainer]): Fox[List[TracingBoxContainer]] =
    Fox.serialCombined(tracingBoxes) { tracingBox: TracingBoxContainer =>
      tracingBox match {
        case TracingBoxContainer(_, _, _, Full(v), Full(datasetId)) =>
          for { volumeAdapted <- addVolumeFallbackBoundingBox(v._1, datasetId) } yield
            tracingBox.copy(volume = Full(volumeAdapted, v._2))
        case _ => Fox.successful(tracingBox)
      }
    }

  // Used in createFromFiles. Called once per requested task if volume tracing is passed
  private def addVolumeFallbackBoundingBox(volume: UploadedVolumeLayer, datasetId: ObjectId): Fox[UploadedVolumeLayer] =
    if (volume.tracing.boundingBox.isEmpty) {
      for {
        dataset <- datasetDAO.findOne(datasetId)(GlobalAccessContext)
        dataSource <- datasetService.dataSourceFor(dataset).flatMap(_.toUsable)
      } yield volume.copy(tracing = volume.tracing.copy(boundingBox = dataSource.boundingBox))
    } else Fox.successful(volume)

  // Used in createFromFiles. Called once per requested task
  private def buildFullParamsFromFilesForSingleTask(
      nmlFormParams: NmlTaskParameters,
      skeletonTracing: Box[SkeletonTracing],
      uploadedVolumeLayer: Box[UploadedVolumeLayer],
      datasetIdBox: Box[ObjectId],
      fileName: Box[String],
      description: Box[Option[String]])(implicit m: MessagesProvider): Box[TaskParameters] = {
    val paramBox: Box[(Option[BoundingBox], ObjectId, Vec3Int, Vec3Double)] =
      (skeletonTracing, datasetIdBox) match {
        case (Full(tracing), Full(datasetId)) =>
          Full((tracing.boundingBox, datasetId, tracing.editPosition, tracing.editRotation))
        case (f: Failure, _) => f
        case (_, f: Failure) => f
        case (_, Empty)      => Failure(Messages("Could not find dataset for task creation."))
        case (Empty, _) =>
          (uploadedVolumeLayer, datasetIdBox) match {
            case (Full(layer), Full(datasetId)) =>
              Full((Some(layer.tracing.boundingBox), datasetId, layer.tracing.editPosition, layer.tracing.editRotation))
            case (f: Failure, _) => f
            case (_, f: Failure) => f
            case _               => Failure(Messages("task.create.needsEitherSkeletonOrVolume"))
          }
      }

    paramBox map { params =>
      val parsedNmlTracingBoundingBox = params._1.map(b => BoundingBox(b.topLeft, b.width, b.height, b.depth))
      val bbox = if (nmlFormParams.boundingBox.isDefined) nmlFormParams.boundingBox else parsedNmlTracingBoundingBox
      TaskParameters(
        nmlFormParams.taskTypeId,
        nmlFormParams.neededExperience,
        nmlFormParams.pendingInstances,
        nmlFormParams.projectName,
        nmlFormParams.scriptId,
        bbox,
        params._2,
        params._3,
        params._4,
        fileName,
        description.toOption.flatten,
        None,
        None,
        None,
        None
      )
    }
  }

  // used in createFromFiles route
  def fillInMissingTracings(skeletons: List[Box[SkeletonTracing]],
                            volumes: List[Box[(UploadedVolumeLayer, Option[File])]],
                            fullParams: List[Box[TaskParameters]],
                            taskType: TaskType,
                            organizationId: String)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[(List[Box[SkeletonTracing]], List[Box[(VolumeTracing, Option[File])]])] =
    if (taskType.tracingType == TracingType.skeleton) {
      Fox.successful(
        skeletons
          .zip(volumes)
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
        skeletons
          .zip(volumes)
          .map {
            case (skeletonTracingBox, volumeTracingBox) =>
              skeletonTracingBox match {
                case Full(_) => (Empty, Failure(Messages("taskType.mismatch", "volume", "skeleton")))
                case _       => (Empty, volumeTracingBox.map(box => (box._1.tracing, box._2)))
              }
          }
          .unzip)
    } else
      Fox
        .serialCombined(fullParams.lazyZip(skeletons).lazyZip(volumes).toList) {
          case (paramBox, skeleton, volume) =>
            paramBox match {
              case Full(params) =>
                val skeletonFox =
                  skeleton
                    .map(s => Fox.successful(s))
                    .openOr(
                      annotationService.createSkeletonTracingBase(params.datasetId,
                                                                  params.boundingBox,
                                                                  params.editPosition,
                                                                  params.editRotation))
                val volumeFox = volume
                  .map(v => Fox.successful(v._1.tracing, v._2))
                  .openOr(annotationService
                    .createVolumeTracingBase(
                      params.datasetId,
                      params.boundingBox,
                      params.editPosition,
                      params.editRotation,
                      volumeShowFallbackLayer = false,
                      magRestrictions = taskType.settings.magRestrictions
                    )
                    .map(v => (v, None)))
                for {
                  skeleton <- skeletonFox
                  volume <- volumeFox
                } yield (Full(skeleton), Full(volume))
              case f: Failure => Fox.failure(f.msg, Empty, f.chain)
              case _          => Fox.failure("")
            }
        }
        .map(_.unzip)

  // used in createFromFiles route
  @SuppressWarnings(Array("OptionGet")) //We suppress this warning because we check the option beforehand
  def combineParamsWithTracings(fullParams: List[Box[TaskParameters]],
                                skeletonBases: List[Box[SkeletonTracing]],
                                volumeBases: List[Box[(VolumeTracing, Option[File])]])
    : List[Box[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])]] =
    fullParams.lazyZip(skeletonBases).lazyZip(volumeBases).map {
      case (paramBox, skeletonBox, volumeBox) =>
        paramBox match {
          case Full(params) =>
            val skeletonFailure = skeletonBox match {
              case f: Failure => Some(f)
              case _          => None
            }
            val volumeFailure = volumeBox match {
              case f: Failure => Some(f)
              case _          => None
            }

            if (skeletonFailure.isDefined || volumeFailure.isDefined)
              skeletonFailure.orElse(volumeFailure).get
            else
              Full(params, skeletonBox.toOption, volumeBox.toOption)
          case f: Failure => f
          case _          => Failure("")
        }
    }

  // Parameters have been completed, tracings have been constructed (or duplicated), on to save them on tracingstore
  // and on to create task and annotation objects
  // Both createFromFiles and create use this method
  def createTasks(
      // TODO pass boxes in again, not just full! Needed for partial error reporting
      requestedTasks: List[Box[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])]],
      taskType: TaskType,
      requestingUser: User)(implicit mp: MessagesProvider, ctx: DBAccessContext): Fox[TaskCreationResult] = {
    val flattenedRequestedTasks = requestedTasks.flatten
    if (flattenedRequestedTasks.isEmpty) {
      // if there is no nonempty task, we directly return all of the errors
      Fox.successful(TaskCreationResult.fromBoxResults(requestedTasks.map(_.map(_ => Json.obj())), List.empty[String]))
    } else {
      for {
        _ <- assertEachHasEitherSkeletonOrVolume(flattenedRequestedTasks) ?~> "task.create.needsEitherSkeletonOrVolume"
        datasetId <- SequenceUtils.findUniqueElement(flattenedRequestedTasks.map(_._1.datasetId)) ?~> "task.create.notOnSameDataset"
        dataset <- datasetDAO.findOne(datasetId) ?~> Messages("dataset.notFound", datasetId)
        _ = if (flattenedRequestedTasks.exists(task => task._1.baseAnnotation.isDefined))
          slackNotificationService.noticeBaseAnnotationTaskCreation(
            taskType._id,
            flattenedRequestedTasks.count(_._1.baseAnnotation.isDefined))
        tracingStoreClient <- tracingStoreService.clientFor(dataset)
        skeletonSaveResults: List[Box[Boolean]] <- tracingStoreClient.saveSkeletonTracings(
          SkeletonTracings(requestedTasks.map(taskTuple => SkeletonTracingOpt(taskTuple._2))))
        // Note that volume tracings are saved sequentially to reduce server load
        volumeTracingIds: List[Box[Option[String]]] <- Fox.serialSequenceBox(requestedTasks) { requestedTask =>
          saveVolumeTracingIfPresent(requestedTask, tracingStoreClient, taskType)
        }
        skeletonTracingsIdsMerged = mergeTracingIds(requestedTasks.map(_.map(_._1)).lazyZip(skeletonTracingIds).toList,
                                                    isSkeletonId = true)
        volumeTracingsIdsMerged = mergeTracingIds(requestedTasks.map(_.map(_._1)).lazyZip(volumeTracingIds).toList,
                                                  isSkeletonId = false)
        requestedTasksWithTracingIds = requestedTasks
          .lazyZip(skeletonTracingsIdsMerged)
          .lazyZip(volumeTracingsIdsMerged)
          .toList
        taskObjects: List[Fox[Task]] = requestedTasksWithTracingIds.map(r =>
          createTaskWithoutAnnotationBase(r._1.map(_._1), r._2, r._3, requestingUser))
        zipped = requestedTasks
          .lazyZip(skeletonTracingsIdsMerged.zip(volumeTracingsIdsMerged))
          .lazyZip(taskObjects)
          .toList
        createAnnotationBaseResults: List[Fox[Unit]] = zipped.map(
          tuple =>
            annotationService.createAndSaveAnnotationBase(
              taskFox = tuple._3,
              requestingUser._id,
              skeletonTracingIdBox = tuple._2._1,
              volumeTracingIdBox = tuple._2._2,
              dataset._id,
              description = tuple._1.map(_._1.description).openOr(None),
              tracingStoreClient
          ))
        warnings <- warnIfTeamHasNoAccess(fullTasks.map(_._1), dataset, requestingUser)
        zippedTasksAndAnnotations = taskObjects zip createAnnotationBaseResults
        taskJsons = zippedTasksAndAnnotations.map(tuple => taskToJsonWithOtherFox(tuple._1, tuple._2))
        result <- TaskCreationResult.fromTaskJsFoxes(taskJsons, warnings)
      } yield result
    }
  }

  private def assertEachHasEitherSkeletonOrVolume(
      requestedTasks: List[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])])
    : Fox[Unit] =
    bool2Fox(
      requestedTasks.forall(tuple => tuple._1.baseAnnotation.isDefined || tuple._2.isDefined || tuple._3.isDefined))

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
      tracingStoreClient: WKRemoteTracingStoreClient,
      taskType: TaskType): Fox[Option[String]] =
    requestedTaskBox.map { tuple =>
      (tuple._1, tuple._3)
    } match {
      case Full((params: TaskParameters, Some((tracing, initialFile)))) =>
        for {
          newAnnotationId <- params.newAnnotationId.toFox
          saveResult <- tracingStoreClient
            .saveVolumeTracing(newAnnotationId,
                               tracing,
                               initialFile,
                               magRestrictions = taskType.settings.magRestrictions)
            .map(Some(_))
        } yield saveResult
      case f: Failure => box2Fox(f)
      case _          => Fox.successful(None)
    }

  private def warnIfTeamHasNoAccess(requestedTasks: List[TaskParameters], dataset: Dataset, requestingUser: User)(
      implicit ctx: DBAccessContext): Fox[List[String]] = {
    val projectNames = requestedTasks.map(_.projectName).distinct
    for {
      projects: List[Project] <- Fox.serialCombined(projectNames)(
        projectDAO.findOneByNameAndOrganization(_, requestingUser._organization)) ?~> "project.notFound"
      datasetTeamIds <- teamService.allowedTeamIdsForDataset(dataset, cumulative = true)
      noAccessTeamIds = projects.map(_._team).diff(datasetTeamIds)
      noAccessTeamIdsTransitive <- Fox.serialCombined(noAccessTeamIds)(id =>
        filterOutTransitiveSubteam(id, datasetTeamIds))
      noAccessTeams: List[Team] <- Fox.serialCombined(noAccessTeamIdsTransitive.flatten)(id => teamDAO.findOne(id))
      warnings = noAccessTeams.map(team =>
        s"Project team “${team.name}” has no read permission to dataset “${dataset.name}”.")
    } yield warnings
  }

  private def filterOutTransitiveSubteam(subteamId: ObjectId, datasetTeams: List[ObjectId]): Fox[Option[ObjectId]] =
    if (datasetTeams.isEmpty) Fox.successful(Some(subteamId))
    else {
      for {
        memberDifference <- userDAO.findTeamMemberDifference(subteamId, datasetTeams)
      } yield if (memberDifference.isEmpty) None else Some(subteamId)
    }

  private def validateScript(scriptIdOpt: Option[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    scriptIdOpt match {
      case Some(scriptId) =>
        for {
          scriptIdValidated <- ObjectId.fromString(scriptId)
          _ <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound"
        } yield ()
      case _ => Fox.successful(())
    }

  private def createTaskWithoutAnnotationBase(paramBox: Box[TaskParameters],
                                              skeletonTracingIdBox: Box[Option[String]],
                                              volumeTracingIdBox: Box[Option[String]],
                                              requestingUser: User)(implicit ctx: DBAccessContext): Fox[Task] =
    for {
      params <- paramBox.toFox
      skeletonIdOpt <- skeletonTracingIdBox.toFox
      volumeIdOpt <- volumeTracingIdBox.toFox
      _ <- bool2Fox(skeletonIdOpt.isDefined || volumeIdOpt.isDefined) ?~> "task.create.needsEitherSkeletonOrVolume"
      taskTypeIdValidated <- ObjectId.fromString(params.taskTypeId)
      project <- projectDAO.findOneByNameAndOrganization(params.projectName, requestingUser._organization) ?~> "project.notFound"
      _ <- validateScript(params.scriptId) ?~> "script.invalid"
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(requestingUser, project._team))
      task = Task(
        ObjectId.generate,
        project._id,
        params.scriptId.map(ObjectId(_)),
        taskTypeIdValidated,
        params.neededExperience.trim,
        params.pendingInstances, //all instances are open at this time
        params.pendingInstances,
        tracingTime = None,
        boundingBox = params.boundingBox.flatMap { box =>
          if (box.isEmpty) None else Some(box)
        },
        editPosition = params.editPosition,
        editRotation = params.editRotation,
        creationInfo = params.creationInfo
      )
      _ <- taskDAO.insertOne(task)
      _ <- userExperiencesDAO.insertExperienceToListing(params.neededExperience.trim.domain,
                                                        requestingUser._organization)
    } yield task

  private def taskToJsonWithOtherFox(taskFox: Fox[Task], otherFox: Fox[Unit])(
      implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      _ <- otherFox
      task <- taskFox
      js <- taskService.publicWrites(task)
    } yield js

  def addNewIdsToTaskParameters(taskParameters: List[TaskParameters], taskType: TaskType): List[TaskParameters] =
    taskParameters.map(addIdsToSingleTaskParameters(_, taskType))

  private def addIdsToSingleTaskParameters(taskParameters: TaskParameters, taskType: TaskType): TaskParameters = {
    val skeletonIdOpt = taskType.tracingType match {
      case TracingType.skeleton | TracingType.hybrid => Some(TracingId.generate)
      case _                                         => None
    }
    val volumeIdOpt = taskType.tracingType match {
      case TracingType.volume | TracingType.hybrid => Some(TracingId.generate)
      case _                                       => None
    }
    val annotationId = ObjectId.generate
    taskParameters.copy(newAnnotationId = Some(annotationId),
                        newSkeletonTracingId = skeletonIdOpt,
                        newVolumeTracingId = volumeIdOpt)
  }
}
