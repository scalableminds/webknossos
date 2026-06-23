package models.task

import com.scalableminds.util.Msg

import java.io.File
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.collections.SequenceUtils
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{
  SkeletonTracing,
  SkeletonTracingOpt,
  SkeletonTracingsWithIds,
  StringOpt
}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryConversions
import com.scalableminds.webknossos.tracingstore.tracings.{TracingId, TracingType}
import com.scalableminds.webknossos.tracingstore.tracings.volume.MagRestrictions

import javax.inject.Inject
import models.annotation.nml.NmlResults.TracingBoxContainer
import models.annotation.*
import models.dataset.{Dataset, DatasetDAO, DatasetService}
import models.project.{Project, ProjectDAO}
import models.team.{Team, TeamDAO, TeamService}
import models.user.{User, UserDAO, UserExperiencesDAO, UserService}
import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
import play.api.libs.json.{JsObject, Json}
import telemetry.SlackNotificationService
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.models.datasource.UsableDataSource

import scala.concurrent.ExecutionContext

class TaskCreationService @Inject() (
    annotationService: AnnotationService,
    taskDAO: TaskDAO,
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
    tracingStoreService: TracingStoreService
)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with ProtoGeometryConversions {

  def assertBatchLimit(batchSize: Int, taskType: TaskType): Fox[Unit] = {
    val batchLimit =
      if (taskType.tracingType == TracingType.volume || taskType.tracingType == TracingType.hybrid)
        100
      else
        1000
    Fox.fromBool(batchSize <= batchLimit) ?~> Msg.Task.Create.batchLimitExceeded(batchLimit)
  }

  // Used in create (without files) in case of base annotation
  // Note that the requested task’s tracingType is always fulfilled here,
  // either by duplicating the base annotation’s tracings or creating new tracings
  def createTracingsFromBaseAnnotations(
      taskParametersList: List[TaskParameters],
      taskType: TaskType,
      dataset: Dataset,
      dataSource: UsableDataSource,
      requestingUserId: ObjectId
  )(using ctx: DBAccessContext): Fox[List[TaskParameters]] =
    Fox.serialCombined(taskParametersList)(params =>
      Fox
        .runOptional(params.baseAnnotation)(
          createTracingsFromBaseAnnotation(_, params, taskType, dataset, dataSource, requestingUserId)
        )
        .map(baseAnnotation => params.copy(baseAnnotation = baseAnnotation))
    )

  // Used in create (without files) in case of base annotation
  private def createTracingsFromBaseAnnotation(
      baseAnnotation: BaseAnnotation,
      taskParameters: TaskParameters,
      taskType: TaskType,
      dataset: Dataset,
      dataSource: UsableDataSource,
      requestingUserId: ObjectId
  )(using ctx: DBAccessContext): Fox[BaseAnnotation] =
    for {
      baseAnnotationIdValidated <- ObjectId.fromString(baseAnnotation.baseId)
      annotation <- resolveBaseAnnotationId(baseAnnotationIdValidated)
      tracingStoreClient <- tracingStoreService.clientFor(dataset)
      _ <- Fox.runOptional(taskParameters.newSkeletonTracingId)(_ =>
        duplicateOrCreateSkeletonBase(annotation, taskParameters, tracingStoreClient, requestingUserId)
      )
      _ <- Fox.runOptional(taskParameters.newVolumeTracingId)(_ =>
        duplicateOrCreateVolumeBase(
          annotation,
          taskParameters,
          tracingStoreClient,
          taskType.settings.magRestrictions,
          dataSource,
          requestingUserId
        )
      )
    } yield BaseAnnotation(
      baseAnnotationIdValidated.id,
      taskParameters.newSkeletonTracingId,
      taskParameters.newVolumeTracingId
    )

  // Used in create (without files) in case of base annotation
  private def resolveBaseAnnotationId(annotationOrTaskId: ObjectId)(using ctx: DBAccessContext): Fox[Annotation] =
    annotationDAO.findOne(annotationOrTaskId).shiftBox.flatMap {
      case Full(value) => Fox.successful(value)
      case _           => resolveBaseTaskId(annotationOrTaskId)
    }

  // Used in create (without files) in case of base annotation
  @SuppressWarnings(
    Array("TraversableHead")
  ) // We check if nonCancelledTaskAnnotations are empty before so head always works
  private def resolveBaseTaskId(taskId: ObjectId)(using ctx: DBAccessContext): Fox[Annotation] =
    (for {
      task <- taskDAO.findOne(taskId)
      annotations <- annotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.Task)
    } yield {
      val nonCancelledTaskAnnotations = annotations.filter(_.state != AnnotationState.Cancelled)
      if (
        task.totalInstances == 1 && task.pendingInstances == 0 &&
        nonCancelledTaskAnnotations.nonEmpty &&
        nonCancelledTaskAnnotations.head.state == AnnotationState.Finished
      )
        Fox.successful(nonCancelledTaskAnnotations.head)
      else Fox.failure(Msg.Task.Create.notOneAnnotation)
    }).flatten

  // Used in create (without files) in case of base annotation
  private def duplicateOrCreateSkeletonBase(
      baseAnnotation: Annotation,
      params: TaskParameters,
      tracingStoreClient: WKRemoteTracingStoreClient,
      requestingUserId: ObjectId
  ): Fox[Unit] =
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
            boundingBox = params.boundingBox,
            ownerId = baseAnnotation._user,
            requestingUserId = requestingUserId
          )
        case None =>
          val skeleton = annotationService.createSkeletonTracingBase(
            params.boundingBox,
            params.editPosition,
            params.editRotation
          )
          tracingStoreClient.saveSkeletonTracing(skeleton, newSkeletonId)
      }
    } yield ()

  // Used in create (without files) in case of base annotation
  private def duplicateOrCreateVolumeBase(
      baseAnnotation: Annotation,
      params: TaskParameters,
      tracingStoreClient: WKRemoteTracingStoreClient,
      magRestrictions: MagRestrictions,
      dataSource: UsableDataSource,
      requestingUserId: ObjectId
  )(using ctx: DBAccessContext): Fox[Unit] =
    for {
      volumeTracingOpt <- baseAnnotation.volumeTracingId
      newVolumeTracingId <- params.newVolumeTracingId.toFox
      newAnnotationId <- params.newAnnotationId.toFox
      newVolumeTracingId <- volumeTracingOpt match {
        case Some(id) =>
          tracingStoreClient.duplicateVolumeTracing(
            id,
            newAnnotationId,
            newVolumeTracingId,
            ownerId = baseAnnotation._user,
            requestingUserId = requestingUserId,
            editPosition = Some(params.editPosition),
            editRotation = Some(params.editRotation),
            magRestrictions = magRestrictions,
            dataSource = dataSource,
            datasetId = params.datasetId
          )
        case None =>
          annotationService
            .createVolumeTracingBase(
              params.datasetId,
              params.boundingBox,
              params.editPosition,
              params.editRotation,
              volumeShowFallbackLayer = false,
              magRestrictions = magRestrictions
            )
            .flatMap(
              tracingStoreClient.saveVolumeTracing(
                newAnnotationId,
                newVolumeTracingId,
                _,
                magRestrictions = magRestrictions,
                dataSource = dataSource,
                datasetId = params.datasetId
              )
            )
      }
    } yield newVolumeTracingId

  // Used in create (without files). If base annotations were used, this does nothing.
  def createTaskSkeletonTracingBases(paramsList: List[TaskParameters]): List[Option[SkeletonTracing]] =
    paramsList.map { params =>
      if (params.baseAnnotation.isEmpty && params.newSkeletonTracingId.isDefined) {
        Some(
          annotationService.createSkeletonTracingBase(
            params.boundingBox,
            params.editPosition,
            params.editRotation
          )
        )
      } else None
    }

  // Used in create (without files). If base annotations were used, this does nothing.
  def createTaskVolumeTracingBases(paramsList: List[TaskParameters], taskType: TaskType)(using
      ctx: DBAccessContext
  ): Fox[List[Option[(VolumeTracing, Option[File])]]] =
    Fox.serialCombined(paramsList) { params =>
      for {
        volumeTracingOpt <-
          if (params.newVolumeTracingId.isDefined && params.baseAnnotation.isEmpty) {
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

  def buildFullParamsFromFiles(
      params: NmlTaskParameters,
      extractedTracingBoxes: List[TracingBoxContainer]
  ): List[Box[TaskParameters]] =
    extractedTracingBoxes.map { boxContainer =>
      buildFullParamsFromFilesForSingleTask(
        params,
        boxContainer.skeleton,
        boxContainer.volume.map(_._1),
        boxContainer.datasetId,
        boxContainer.fileName,
        boxContainer.description
      )
    }

  // Used in createFromFiles. For all volume tracings that have an empty bounding box, reset it to the dataset bounding box
  def addVolumeFallbackBoundingBoxes(tracingBoxes: List[TracingBoxContainer]): Fox[List[TracingBoxContainer]] =
    Fox.serialCombined(tracingBoxes) { (tracingBox: TracingBoxContainer) =>
      tracingBox match {
        case TracingBoxContainer(_, _, _, Full(v), Full(datasetId)) =>
          for { volumeAdapted <- addVolumeFallbackBoundingBox(v._1, datasetId) } yield tracingBox.copy(volume =
            Full(volumeAdapted, v._2)
          )
        case _ => Fox.successful(tracingBox)
      }
    }

  // Used in createFromFiles. Called once per requested task if volume tracing is passed
  private def addVolumeFallbackBoundingBox(volume: UploadedVolumeLayer, datasetId: ObjectId): Fox[UploadedVolumeLayer] =
    if (boundingBoxFromProto(volume.tracing.boundingBox).isEmpty) {
      for {
        dataset <- datasetDAO.findOne(datasetId)(using GlobalAccessContext)
        dataSource <- datasetService.usableDataSourceFor(dataset)
      } yield volume.copy(tracing = volume.tracing.copy(boundingBox = boundingBoxToProto(dataSource.boundingBox)))
    } else Fox.successful(volume)

  // Used in createFromFiles. Called once per requested task
  private def buildFullParamsFromFilesForSingleTask(
      nmlFormParams: NmlTaskParameters,
      skeletonTracing: Box[SkeletonTracing],
      uploadedVolumeLayer: Box[UploadedVolumeLayer],
      datasetIdBox: Box[ObjectId],
      fileName: Box[String],
      description: Box[Option[String]]
  ): Box[TaskParameters] = {
    val paramBox: Box[(Option[BoundingBox], ObjectId, Vec3Int, Vec3Double)] =
      (skeletonTracing, datasetIdBox) match {
        case (Full(tracing), Full(datasetId)) =>
          Full(
            (
              boundingBoxOptFromProto(tracing.boundingBox),
              datasetId,
              vec3IntFromProto(tracing.editPosition),
              vec3DoubleFromProto(tracing.editRotation)
            )
          )
        case (f: Failure, _) => f
        case (_, f: Failure) => f
        case (_, Empty)      => Failure("Could not find dataset for task creation.")
        case (Empty, _)      =>
          (uploadedVolumeLayer, datasetIdBox) match {
            case (Full(layer), Full(datasetId)) =>
              Full(
                (
                  Some(boundingBoxFromProto(layer.tracing.boundingBox)),
                  datasetId,
                  vec3IntFromProto(layer.tracing.editPosition),
                  vec3DoubleFromProto(layer.tracing.editRotation)
                )
              )
            case (f: Failure, _) => f
            case (_, f: Failure) => f
            case _               => Failure(Msg.Task.Create.needsEitherSkeletonOrVolume)
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
        fileName.toOption,
        description.toOption.flatten,
        None,
        None,
        None,
        None
      )
    }
  }

  // used in createFromFiles route
  def fillInMissingTracings(
      skeletons: List[Box[SkeletonTracing]],
      volumes: List[Box[(UploadedVolumeLayer, Option[File])]],
      fullParams: List[Box[TaskParameters]],
      taskType: TaskType
  )(using ctx: DBAccessContext): Fox[(List[Box[SkeletonTracing]], List[Box[(VolumeTracing, Option[File])]])] =
    if (taskType.tracingType == TracingType.skeleton) {
      Fox.successful(
        skeletons
          .zip(volumes)
          .map { case (skeletonTracingBox, _) =>
            // drop the volume if it exists
            (skeletonTracingBox, Empty)
          }
          .unzip
      )
    } else if (taskType.tracingType == TracingType.volume) {
      Fox.successful(
        skeletons
          .zip(volumes)
          .map { case (_, volumeTracingBox) =>
            // drop the skeleton if it exists
            (Empty, volumeTracingBox.map(box => (box._1.tracing, box._2)))
          }
          .unzip
      )
    } else
      Fox
        .serialCombined(fullParams.lazyZip(skeletons).lazyZip(volumes).toList) { case (paramBox, skeleton, volume) =>
          paramBox match {
            case Full(params) =>
              val skeletonFox =
                Fox.successful(
                  skeleton.toOption.getOrElse(
                    annotationService
                      .createSkeletonTracingBase(params.boundingBox, params.editPosition, params.editRotation)
                  )
                )
              val volumeFox = volume
                .map(v => Fox.successful(v._1.tracing, v._2))
                .getOrElse(
                  annotationService
                    .createVolumeTracingBase(
                      params.datasetId,
                      params.boundingBox,
                      params.editPosition,
                      params.editRotation,
                      volumeShowFallbackLayer = false,
                      magRestrictions = taskType.settings.magRestrictions
                    )
                    .map(v => (v, None))
                )
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
  @SuppressWarnings(Array("OptionGet")) // We suppress this warning because we check the option beforehand
  def combineParamsWithTracings(
      fullParams: List[Box[TaskParameters]],
      skeletonBases: List[Box[SkeletonTracing]],
      volumeBases: List[Box[(VolumeTracing, Option[File])]]
  ): List[Box[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])]] =
    fullParams.lazyZip(skeletonBases).lazyZip(volumeBases).map { case (paramBox, skeletonBox, volumeBox) =>
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
      requestedTasks: List[Box[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])]],
      taskType: TaskType,
      requestingUser: User
  )(using ctx: DBAccessContext): Fox[TaskCreationResult] = {
    val flattenedRequestedTasks = requestedTasks.flatten
    if (flattenedRequestedTasks.isEmpty) {
      // if there is no nonempty task, we directly return all of the errors
      Fox.successful(TaskCreationResult.fromBoxResults(requestedTasks.map(_.map(_ => Json.obj())), List.empty[String]))
    } else {
      for {
        datasetId <- SequenceUtils
          .findUniqueElement(flattenedRequestedTasks.map(_._1.datasetId))
          .toFox ?~> Msg.Task.Create.notOnSameDataset
        dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId)
        dataSource <- datasetService.usableDataSourceFor(dataset)
        _ <- assertEachHasEitherSkeletonOrVolume(
          flattenedRequestedTasks
        ) ?~> Msg.Task.Create.needsEitherSkeletonOrVolume
        _ = if (flattenedRequestedTasks.exists(task => task._1.baseAnnotation.isDefined))
          slackNotificationService.noticeBaseAnnotationTaskCreation(
            taskType._id,
            flattenedRequestedTasks.count(_._1.baseAnnotation.isDefined)
          )
        tracingStoreClient <- tracingStoreService.clientFor(dataset)
        skeletonSaveResults: List[Box[Boolean]] <- tracingStoreClient.saveSkeletonTracings(
          SkeletonTracingsWithIds(
            requestedTasks.map(tuple => SkeletonTracingOpt(tuple.map(_._2).getOrElse(None))),
            requestedTasks.map(tuple => StringOpt(tuple.map(_._1.newAnnotationId.map(_.toString)).getOrElse(None))),
            requestedTasks.map(tuple => StringOpt(tuple.map(_._1.newSkeletonTracingId).getOrElse(None)))
          )
        )
        // Note that volume tracings are saved sequentially to reduce server load
        volumeSaveResults: List[Box[Unit]] <- Fox.fromFuture(Fox.serialSequence(requestedTasks) { requestedTask =>
          saveVolumeTracingIfPresent(requestedTask, tracingStoreClient, taskType, dataSource)
        })
        requestedTasksWithTracingSaveResults = requestedTasks
          .lazyZip(skeletonSaveResults)
          .lazyZip(volumeSaveResults)
          .toList
        taskObjects: List[Fox[Task]] = requestedTasksWithTracingSaveResults.map(r =>
          createTaskWithoutAnnotationBase(r._1.map(_._1), r._2, r._3, taskType, requestingUser)
        )
        createAnnotationBaseResults: List[Fox[Unit]] = requestedTasks.lazyZip(taskObjects).toList.map {
          case (requestedTaskBox, taskFox) =>
            annotationService.createAndSaveAnnotationBase(
              taskFox = taskFox,
              requestingUser._id,
              skeletonTracingIdBox = requestedTaskBox.map(_._1.newSkeletonTracingId),
              volumeTracingIdBox = requestedTaskBox.map(_._1.newVolumeTracingId),
              dataset._id,
              description = requestedTaskBox.map(_._1.description).getOrElse(None),
              tracingStoreClient
            )
        }
        warnings <- warnIfTeamHasNoAccess(flattenedRequestedTasks.map(_._1), dataset, requestingUser)
        zippedTasksAndAnnotations = taskObjects zip createAnnotationBaseResults
        taskJsons = zippedTasksAndAnnotations.map(tuple => taskToJsonWithOtherFox(tuple._1, tuple._2))
        result <- Fox.fromFuture(TaskCreationResult.fromTaskJsFoxes(taskJsons, warnings))
      } yield result
    }
  }

  private def assertEachHasEitherSkeletonOrVolume(
      requestedTasks: List[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])]
  ): Fox[Unit] =
    Fox.fromBool(
      requestedTasks.forall(tuple => tuple._1.baseAnnotation.isDefined || tuple._2.isDefined || tuple._3.isDefined)
    )

  private def saveVolumeTracingIfPresent(
      requestedTaskBox: Box[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])],
      tracingStoreClient: WKRemoteTracingStoreClient,
      taskType: TaskType,
      dataSource: UsableDataSource
  ): Fox[Unit] =
    requestedTaskBox.map { tuple =>
      (tuple._1, tuple._3)
    } match {
      case Full((params: TaskParameters, Some((tracing, initialFile)))) =>
        for {
          newAnnotationId <- params.newAnnotationId.toFox
          newVolumeTracingId <- params.newVolumeTracingId.toFox
          saveResult <- tracingStoreClient.saveVolumeTracing(
            newAnnotationId,
            newVolumeTracingId,
            tracing,
            initialFile,
            magRestrictions = taskType.settings.magRestrictions,
            dataSource,
            params.datasetId
          )
        } yield saveResult
      case f: Failure => f.toFox
      case _          => Fox.empty
    }

  private def warnIfTeamHasNoAccess(requestedTasks: List[TaskParameters], dataset: Dataset, requestingUser: User)(using
      ctx: DBAccessContext
  ): Fox[List[String]] = {
    val projectNames = requestedTasks.map(_.projectName).distinct
    for {
      projects: List[Project] <- Fox.serialCombined(projectNames)(name =>
        projectDAO.findOneByNameAndOrganization(name, requestingUser._organization) ?~> Msg.Project.notFound(name)
      )
      datasetTeamIds <- teamService.allowedTeamIdsForDataset(dataset, cumulative = true)
      noAccessTeamIds = projects.map(_._team).diff(datasetTeamIds)
      noAccessTeamIdsTransitive <- Fox.serialCombined(noAccessTeamIds)(id =>
        filterOutTransitiveSubteam(id, datasetTeamIds)
      )
      noAccessTeams: List[Team] <- Fox.serialCombined(noAccessTeamIdsTransitive.flatten)(id => teamDAO.findOne(id))
      warnings = noAccessTeams.map(team =>
        s"Project team “${team.name}” has no read permission to dataset “${dataset.name}”."
      )
    } yield warnings
  }

  private def filterOutTransitiveSubteam(subteamId: ObjectId, datasetTeams: List[ObjectId]): Fox[Option[ObjectId]] =
    if (datasetTeams.isEmpty) Fox.successful(Some(subteamId))
    else {
      for {
        memberDifference <- userDAO.findTeamMemberDifference(subteamId, datasetTeams)
      } yield if (memberDifference.isEmpty) None else Some(subteamId)
    }

  private def createTaskWithoutAnnotationBase(
      paramBox: Box[TaskParameters],
      skeletonSaveResult: Box[Boolean],
      volumeSaveResult: Box[Unit],
      taskType: TaskType,
      requestingUser: User
  )(using ctx: DBAccessContext): Fox[Task] =
    for {
      params <- paramBox.toFox
      _ <- Fox.fromBool(
        params.newSkeletonTracingId.isDefined || params.newVolumeTracingId.isDefined
      ) ?~> Msg.Task.Create.needsEitherSkeletonOrVolume
      _ <- Fox.runIf(params.newSkeletonTracingId.isDefined && !params.baseAnnotation.exists(_.skeletonId.isDefined))(
        skeletonSaveResult.toFox
      ) ?~> Msg.Task.Create.saveSkeletonFailed
      _ <- Fox.runIf(params.newVolumeTracingId.isDefined && !params.baseAnnotation.exists(_.volumeId.isDefined))(
        volumeSaveResult.toFox
      ) ?~> Msg.Task.Create.saveVolumeFailed
      project <- projectDAO.findOneByNameAndOrganization(
        params.projectName,
        requestingUser._organization
      ) ?~> Msg.Project.notFound(params.projectName)
      _ <- Fox.runOptional(params.scriptId)(id => scriptDAO.findOne(id) ?~> Msg.Script.notFound(id))
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(requestingUser, project._team))
      task = Task(
        ObjectId.generate,
        project._id,
        params.scriptId,
        taskType._id,
        params.neededExperience.trim,
        params.pendingInstances, // all instances are open at this time
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
      _ <- userExperiencesDAO.insertExperienceToListing(
        params.neededExperience.trim.domain,
        requestingUser._organization
      )
    } yield task

  private def taskToJsonWithOtherFox(taskFox: Fox[Task], otherFox: Fox[Unit])(using
      ctx: DBAccessContext
  ): Fox[JsObject] =
    for {
      _ <- otherFox
      task <- taskFox
      js <- taskService.publicWrites(task)
    } yield js

  def addNewIdsToTaskParameters(taskParameters: List[TaskParameters], taskType: TaskType): List[TaskParameters] =
    taskParameters.map(addIdsToSingleTaskParameters(_, taskType))

  def addNewIdsToTaskParametersBoxed(
      taskParameters: List[Box[TaskParameters]],
      taskType: TaskType
  ): List[Box[TaskParameters]] =
    taskParameters.map(_.map(addIdsToSingleTaskParameters(_, taskType)))

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
    taskParameters.copy(
      newAnnotationId = Some(annotationId),
      newSkeletonTracingId = skeletonIdOpt,
      newVolumeTracingId = volumeIdOpt
    )
  }
}
