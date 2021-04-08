package models.task

import java.io.File

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.ResolutionRestrictions
import javax.inject.Inject
import models.annotation.nml.NmlResults.TracingBoxContainer
import models.annotation.{
  Annotation,
  AnnotationDAO,
  AnnotationService,
  AnnotationState,
  AnnotationType,
  TracingStoreRpcClient,
  TracingStoreService
}
import models.binary.{DataSet, DataSetDAO, DataSetService}
import models.project.{Project, ProjectDAO}
import models.team.{Team, TeamDAO}
import models.user.{User, UserExperiencesDAO, UserService, UserTeamRolesDAO}
import net.liftweb.common.{Box, Empty, Failure, Full}
import oxalis.telemetry.SlackNotificationService
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
                                    userExperiencesDAO: UserExperiencesDAO,
                                    scriptDAO: ScriptDAO,
                                    dataSetDAO: DataSetDAO,
                                    dataSetService: DataSetService,
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
  // Note that the requested task’s tracingType is always fulfilled here,
  // either by duplicating the base annotation’s tracings or creating new tracings
  def createTracingsFromBaseAnnotations(taskParametersList: List[TaskParameters], organizationId: ObjectId)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[TaskParameters]] =
    Fox.serialCombined(taskParametersList)(
      params =>
        Fox
          .runOptional(params.baseAnnotation)(createTracingsFromBaseAnnotation(_, params, organizationId))
          .map(baseAnnotation => params.copy(baseAnnotation = baseAnnotation)))

  // Used in create (without files) in case of base annotation
  private def createTracingsFromBaseAnnotation(
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
  private def duplicateOrCreateSkeletonBase(baseAnnotation: Annotation,
                                            params: TaskParameters,
                                            tracingStoreClient: TracingStoreRpcClient): Fox[String] =
    baseAnnotation.skeletonTracingId
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
      baseAnnotation: Annotation,
      params: TaskParameters,
      tracingStoreClient: TracingStoreRpcClient,
      organizationId: ObjectId,
      resolutionRestrictions: ResolutionRestrictions)(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[String] =
    baseAnnotation.volumeTracingId
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

  // Used in create (without files). If base annotations were used, this does nothing.
  def createTaskSkeletonTracingBases(paramsList: List[TaskParameters])(
      implicit ctx: DBAccessContext): Fox[List[Option[SkeletonTracing]]] =
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

  // Used in create (without files). If base annotations were used, this does nothing.
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

  def buildFullParamsFromFiles(params: NmlTaskParameters, extractedTracingBoxes: List[TracingBoxContainer])(
      implicit m: MessagesProvider): List[Box[TaskParameters]] =
    extractedTracingBoxes.map { boxContainer =>
      buildFullParamsFromFilesForSingleTask(params,
                                            boxContainer.skeleton,
                                            boxContainer.volume.map(_._1),
                                            boxContainer.fileName,
                                            boxContainer.description)
    }

  // Used in createFromFiles. For all volume tracings that have an empty bounding box, reset it to the dataset bounding box
  def addVolumeFallbackBoundingBoxes(tracingBoxes: List[TracingBoxContainer],
                                     organizationId: ObjectId): Fox[List[TracingBoxContainer]] =
    Fox.serialCombined(tracingBoxes) { tracingBox: TracingBoxContainer =>
      tracingBox.volume match {
        case Full(v) =>
          for { volumeAdapted <- addVolumeFallbackBoundingBox(v._1, organizationId) } yield
            tracingBox.copy(volume = Full(volumeAdapted, v._2))
        case _ => Fox.successful(tracingBox)
      }
    }

  // Used in createFromFiles. Called once per requested task if volume tracing is passed
  private def addVolumeFallbackBoundingBox(volume: VolumeTracing, organizationId: ObjectId): Fox[VolumeTracing] =
    if (volume.boundingBox.isEmpty) {
      for {
        dataSet <- dataSetDAO.findOneByNameAndOrganization(volume.dataSetName, organizationId)(GlobalAccessContext)
        dataSource <- dataSetService.dataSourceFor(dataSet).flatMap(_.toUsable)
      } yield volume.copy(boundingBox = dataSource.boundingBox)
    } else Fox.successful(volume)

  // Used in createFromFiles. Called once per requested task
  private def buildFullParamsFromFilesForSingleTask(
      nmlFormParams: NmlTaskParameters,
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
  def fillInMissingTracings(skeletons: List[Box[SkeletonTracing]],
                            volumes: List[Box[(VolumeTracing, Option[File])]],
                            fullParams: List[Box[TaskParameters]],
                            taskType: TaskType,
                            organizationId: ObjectId)(
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
                case _       => (Empty, volumeTracingBox)
              }
          }
          .unzip)
    } else
      Fox
        .serialCombined((fullParams, skeletons, volumes).zipped.toList) {
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

  // used in createFromFiles route
  @SuppressWarnings(Array("OptionGet")) //We suppress this warning because we check the option beforehand
  def combineParamsWithTracings(fullParams: List[Box[TaskParameters]],
                                skeletonBases: List[Box[SkeletonTracing]],
                                volumeBases: List[Box[(VolumeTracing, Option[File])]])
    : List[Box[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])]] =
    (fullParams, skeletonBases, volumeBases).zipped.map {
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
      requestedTasks: List[Box[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])]],
      requestingUser: User)(implicit mp: MessagesProvider, ctx: DBAccessContext): Fox[TaskCreationResult] = {
    val fullTasks = requestedTasks.flatten
    if (fullTasks.isEmpty) {
      // if there is no nonempty task, we directly return all of the errors
      return Fox.successful(
        TaskCreationResult.fromBoxResults(requestedTasks.map(_.map(_ => Json.obj())), List.empty[String]))
    }

    for {
      _ <- assertEachHasEitherSkeletonOrVolume(fullTasks) ?~> "task.create.needsEitherSkeletonOrVolume"
      firstDatasetName <- fullTasks.headOption.map(_._1.dataSet).toFox
      _ <- assertAllOnSameDataset(fullTasks, firstDatasetName)
      dataSet <- dataSetDAO.findOneByNameAndOrganization(firstDatasetName, requestingUser._organization) ?~> Messages(
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
        createTaskWithoutAnnotationBase(r._1.map(_._1), r._2, r._3, requestingUser))
      zipped = (requestedTasks, skeletonTracingsIdsMerged.zip(volumeTracingsIdsMerged), taskObjects).zipped.toList
      createAnnotationBaseResults: List[Fox[Unit]] = zipped.map(
        tuple =>
          annotationService.createAnnotationBase(
            taskFox = tuple._3,
            requestingUser._id,
            skeletonTracingIdBox = tuple._2._1,
            volumeTracingIdBox = tuple._2._2,
            dataSet._id,
            description = tuple._1.map(_._1.description).openOr(None)
        ))
      warnings <- warnIfTeamHasNoAccess(fullTasks.map(_._1), dataSet, requestingUser)
      zippedTasksAndAnnotations = taskObjects zip createAnnotationBaseResults
      taskJsons = zippedTasksAndAnnotations.map(tuple => taskToJsonWithOtherFox(tuple._1, tuple._2))
      result <- TaskCreationResult.fromTaskJsFoxes(taskJsons, warnings)
    } yield result
  }

  private def assertEachHasEitherSkeletonOrVolume(
      requestedTasks: List[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])])
    : Fox[Unit] =
    bool2Fox(
      requestedTasks.forall(tuple => tuple._1.baseAnnotation.isDefined || tuple._2.isDefined || tuple._3.isDefined))

  private def assertAllOnSameDataset(
      requestedTasks: List[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])],
      firstDatasetName: String)(implicit mp: MessagesProvider): Fox[String] = {
    @scala.annotation.tailrec
    def allOnSameDatasetIter(
        requestedTasksRest: List[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])],
        dataSetName: String): Boolean =
      requestedTasksRest match {
        case List()       => true
        case head :: tail => head._1.dataSet == dataSetName && allOnSameDatasetIter(tail, dataSetName)
      }

    if (allOnSameDatasetIter(requestedTasks, firstDatasetName))
      Fox.successful(firstDatasetName)
    else
      Fox.failure(Messages("task.notOnSameDataSet"))
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

  private def warnIfTeamHasNoAccess(requestedTasks: List[TaskParameters], dataSet: DataSet, requestingUser: User)(
      implicit ctx: DBAccessContext): Fox[List[String]] = {
    val projectNames = requestedTasks.map(_.projectName).distinct
    for {
      projects: List[Project] <- Fox.serialCombined(projectNames)(
        projectDAO.findOneByNameAndOrganization(_, requestingUser._organization))
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
                                              volumeTracingIdBox: Box[Option[String]],
                                              requestingUser: User)(implicit ctx: DBAccessContext): Fox[Task] =
    for {
      params <- paramBox.toFox
      skeletonIdOpt <- skeletonTracingIdBox.toFox
      volumeIdOpt <- volumeTracingIdBox.toFox
      _ <- bool2Fox(skeletonIdOpt.isDefined || volumeIdOpt.isDefined) ?~> "task.create.needsEitherSkeletonOrVolume"
      taskTypeIdValidated <- ObjectId.parse(params.taskTypeId)
      project <- projectDAO.findOneByNameAndOrganization(params.projectName, requestingUser._organization) ?~> "project.notFound"
      _ <- validateScript(params.scriptId) ?~> "script.invalid"
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(requestingUser, project._team))
      task = Task(
        ObjectId.generate,
        project._id,
        params.scriptId.map(ObjectId(_)),
        taskTypeIdValidated,
        params.neededExperience.trim,
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
}
