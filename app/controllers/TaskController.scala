package controllers

import java.io.File

import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.SecuredRequest
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.mvc.ResultBox
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.tracings.volume.ResolutionRestrictions
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import javax.inject.Inject
import models.annotation.nml.NmlService
import models.annotation._
import models.binary.{DataSet, DataSetDAO}
import models.project.{Project, ProjectDAO}
import models.task._
import models.team.{Team, TeamDAO}
import models.user._
import net.liftweb.common.{Box, Empty, Failure, Full}
import oxalis.security.WkEnv
import oxalis.telemetry.SlackNotificationService.SlackNotificationService
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json._
import play.api.mvc.{PlayBodyParsers, Result}
import utils.{ObjectId, WkConf}

import scala.concurrent.{ExecutionContext, Future}

case class TaskParameters(
    taskTypeId: String,
    neededExperience: Experience,
    openInstances: Int,
    projectName: String,
    scriptId: Option[String],
    boundingBox: Option[BoundingBox],
    dataSet: String,
    editPosition: Point3D,
    editRotation: Vector3D,
    creationInfo: Option[String],
    description: Option[String],
    baseAnnotation: Option[BaseAnnotation]
)

object TaskParameters {
  implicit val taskParametersFormat: Format[TaskParameters] = Json.format[TaskParameters]
}

case class NmlTaskParameters(taskTypeId: String,
                             neededExperience: Experience,
                             openInstances: Int,
                             projectName: String,
                             scriptId: Option[String],
                             boundingBox: Option[BoundingBox])

object NmlTaskParameters {
  implicit val nmlTaskParametersFormat: Format[NmlTaskParameters] = Json.format[NmlTaskParameters]
}

case class BaseAnnotation(baseId: String, skeletonId: Option[String] = None, volumeId: Option[String] = None) // baseId is the id of the old Annotation which should be used as base for the new annotation, skeletonId/volumeId are the ids of the dupliated tracings from baseId

object BaseAnnotation {
  implicit val baseAnnotationFormat: Format[BaseAnnotation] = Json.format[BaseAnnotation]
}

class TaskController @Inject()(annotationDAO: AnnotationDAO,
                               annotationService: AnnotationService,
                               scriptDAO: ScriptDAO,
                               projectDAO: ProjectDAO,
                               taskTypeDAO: TaskTypeDAO,
                               dataSetDAO: DataSetDAO,
                               userTeamRolesDAO: UserTeamRolesDAO,
                               userService: UserService,
                               tracingStoreService: TracingStoreService,
                               teamDAO: TeamDAO,
                               taskDAO: TaskDAO,
                               taskService: TaskService,
                               nmlService: NmlService,
                               slackNotificationService: SlackNotificationService,
                               conf: WkConf,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with ResultBox
    with ProtoGeometryImplicits
    with FoxImplicits {

  private val MAX_OPEN_TASKS: Int = conf.WebKnossos.Tasks.maxOpenPerUser

  def read(taskId: String) = sil.SecuredAction.async { implicit request =>
    for {
      task <- taskDAO.findOne(ObjectId(taskId)) ?~> "task.notFound" ~> NOT_FOUND
      js <- taskService.publicWrites(task)
    } yield {
      Ok(js)
    }
  }

  def create = sil.SecuredAction.async(validateJson[List[TaskParameters]]) { implicit request =>
    for {
      isVolumeOrHybrid <- isVolumeOrHybridTaskType(request.body)
      _ <- bool2Fox(if (isVolumeOrHybrid) request.body.length <= 100 else request.body.length <= 1000) ?~> "task.create.limitExceeded"
      taskParameters <- duplicateAllBaseTracings(request.body, request.identity._organization)
      skeletonBaseOpts: List[Option[SkeletonTracing]] <- createTaskSkeletonTracingBases(taskParameters)
      volumeBaseOpts: List[Option[(VolumeTracing, Option[File])]] <- createTaskVolumeTracingBases(
        taskParameters,
        request.identity._organization)
      result <- createTasks((taskParameters, skeletonBaseOpts, volumeBaseOpts).zipped.map {
        case (params, skeletonOpt, volumeOpt) => Full((params, skeletonOpt, volumeOpt))
      })
    } yield result
  }

  private def duplicateAllBaseTracings(taskParametersList: List[TaskParameters], organizationId: ObjectId)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[TaskParameters]] =
    Fox.serialCombined(taskParametersList)(
      params =>
        Fox
          .runOptional(params.baseAnnotation)(duplicateBaseTracings(_, params, organizationId))
          .map(baseAnnotation => params.copy(baseAnnotation = baseAnnotation)))

  private def duplicateSkeletonTracingOrCreateSkeletonTracingBase(
      annotation: Annotation,
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

  private def duplicateVolumeTracingOrCreateVolumeTracingBase(
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

  private def duplicateBaseTracings(
      baseAnnotation: BaseAnnotation,
      taskParameters: TaskParameters,
      organizationId: ObjectId)(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[BaseAnnotation] = {

    @SuppressWarnings(Array("TraversableHead")) // We check if nonCancelledTaskAnnotations are empty before so head always works
    def checkForTask(taskId: ObjectId): Fox[Annotation] =
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

    def useAnnotationIdOrCheckForTask(annotationOrTaskId: ObjectId): Fox[Annotation] =
      annotationDAO
        .findOne(annotationOrTaskId)
        .futureBox
        .map {
          case Full(value) => Fox.successful(value)
          case _           => checkForTask(annotationOrTaskId)
        }
        .toFox
        .flatten

    for {
      taskTypeIdValidated <- ObjectId.parse(taskParameters.taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
      dataSet <- dataSetDAO.findOneByNameAndOrganization(taskParameters.dataSet, organizationId)
      baseAnnotationIdValidated <- ObjectId.parse(baseAnnotation.baseId)
      annotation <- useAnnotationIdOrCheckForTask(baseAnnotationIdValidated)
      tracingStoreClient <- tracingStoreService.clientFor(dataSet)
      newSkeletonId <- if (taskType.tracingType == TracingType.skeleton || taskType.tracingType == TracingType.hybrid)
        duplicateSkeletonTracingOrCreateSkeletonTracingBase(annotation, taskParameters, tracingStoreClient).map(Some(_))
      else Fox.successful(None)
      newVolumeId <- if (taskType.tracingType == TracingType.volume || taskType.tracingType == TracingType.hybrid)
        duplicateVolumeTracingOrCreateVolumeTracingBase(annotation,
                                                        taskParameters,
                                                        tracingStoreClient,
                                                        organizationId,
                                                        taskType.settings.resolutionRestrictions).map(Some(_))
      else Fox.successful(None)
    } yield BaseAnnotation(baseAnnotationIdValidated.id, newSkeletonId, newVolumeId)
  }

  private def createTaskSkeletonTracingBases(paramsList: List[TaskParameters])(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[Option[SkeletonTracing]]] =
    Fox.serialCombined(paramsList) { params =>
      for {
        taskTypeIdValidated <- ObjectId.parse(params.taskTypeId) ?~> "taskType.id.invalid"
        taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
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

  private def createTaskVolumeTracingBases(paramsList: List[TaskParameters], organizationId: ObjectId)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[Option[(VolumeTracing, Option[File])]]] =
    Fox.serialCombined(paramsList) { params =>
      for {
        taskTypeIdValidated <- ObjectId.parse(params.taskTypeId) ?~> "taskType.id.invalid"
        taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
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

  private def getTracingBases(skeletonBaseOpts: List[Box[SkeletonTracing]],
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

  @SuppressWarnings(Array("OptionGet")) // We can safely call get on the Option because we check that one of the failures is defined
  def createFromFiles = sil.SecuredAction.async { implicit request =>
    for {
      body <- request.body.asMultipartFormData ?~> "binary.payload.invalid"
      inputFiles = body.files.filter(file =>
        file.filename.toLowerCase.endsWith(".nml") || file.filename.toLowerCase.endsWith(".zip"))
      _ <- bool2Fox(inputFiles.nonEmpty) ?~> "nml.file.notFound"
      jsonString <- body.dataParts.get("formJSON").flatMap(_.headOption) ?~> "format.json.missing"
      params <- JsonHelper.parseJsonToFox[NmlTaskParameters](jsonString) ?~> "task.create.failed"
      taskTypeIdValidated <- ObjectId.parse(params.taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
      _ <- bool2Fox(
        if (taskType.tracingType != TracingType.skeleton) inputFiles.length <= 100
        else inputFiles.length <= 1000) ?~> "task.create.limitExceeded"
      project <- projectDAO
        .findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName) ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
      extractedFiles = nmlService.extractFromFiles(inputFiles.map(f => (f.ref.path.toFile, f.filename)),
                                                   useZipName = false,
                                                   isTaskUpload = true)
      successes <- Fox.sequence(extractedFiles.parseResults.map(_.toSuccessFox)) ?~> "task.create.failed"
      skeletonBaseBoxes: List[Box[SkeletonTracing]] = successes.map {
        case Full(success) =>
          success.skeletonTracing match {
            case Some(value) => Full(value)
            case None        => Empty
          }
        case f: Failure => f
        case _          => Failure("")
      }
      volumeBaseBoxes: List[Box[(VolumeTracing, Option[File])]] = successes.map {
        case Full(success) =>
          success.volumeTracingWithDataLocation match {
            case Some((tracing, name)) => Full((tracing, extractedFiles.otherFiles.get(name).map(_.path.toFile)))
            case None                  => Empty
          }
        case f: Failure => f
        case _          => Failure("")
      }
      fullParams = (successes, skeletonBaseBoxes, volumeBaseBoxes).zipped.map {
        case (s, skeletonBox, volumeBox) =>
          buildFullParams(params, skeletonBox, volumeBox.map(_._1), s.map(_.fileName), s.map(_.description))
      }
      (skeletonBases, volumeBases) <- getTracingBases(skeletonBaseBoxes,
                                                      volumeBaseBoxes,
                                                      fullParams,
                                                      taskType,
                                                      request.identity._organization)
      taskParams: List[Box[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])]] = (fullParams,
                                                                                                                 skeletonBases,
                                                                                                                 volumeBases).zipped.map {
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

      result <- createTasks(taskParams)
    } yield {
      result
    }
  }

  private def buildFullParams(nmlFormParams: NmlTaskParameters,
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

  def createTasks(
      requestedTasks: List[Box[(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])]])(
      implicit request: SecuredRequest[WkEnv, _]): Fox[Result] = {
    val fullTasks = requestedTasks.flatten
    if (fullTasks.isEmpty) {
      // if there is no nonempty task, we directly return all of the errors
      return Fox.successful(
        Ok(
          Json.toJson(Json.obj("tasks" -> bulk2StatusJson(requestedTasks.map(_.map(_ => Json.obj()))),
                               "warnings" -> List.empty[String]))))
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

    def taskToJsonFoxed(taskFox: Fox[Task], otherFox: Fox[_]): Fox[JsObject] =
      for {
        _ <- otherFox
        task <- taskFox
        js <- taskService.publicWrites(task)
      } yield js

    for {
      _ <- assertEachHasEitherSkeletonOrVolume ?~> "task.create.needsEitherSkeletonOrVolume"
      firstDatasetName <- fullTasks.headOption.map(_._1.dataSet).toFox
      _ <- assertAllOnSameDataset(firstDatasetName)
      dataSet <- dataSetDAO.findOneByNameAndOrganization(firstDatasetName, request.identity._organization) ?~> Messages(
        "dataSet.notFound",
        firstDatasetName) ~> NOT_FOUND
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
      annotationBases = zipped.map(
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
      zippedTasksAndAnnotations = taskObjects zip annotationBases
      taskJsons = zippedTasksAndAnnotations.map(tuple => taskToJsonFoxed(tuple._1, tuple._2))
      result <- {
        val taskJsonFuture: Future[List[Box[JsObject]]] = Fox.sequence(taskJsons)
        taskJsonFuture.map { taskJsonBoxes =>
          Json.obj("tasks" -> bulk2StatusJson(taskJsonBoxes), "warnings" -> warnings)
        }
      }
    } yield Ok(Json.toJson(result))
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

  private def validateScript(scriptIdOpt: Option[String])(implicit request: SecuredRequest[WkEnv, _]): Fox[Unit] =
    scriptIdOpt match {
      case Some(scriptId) =>
        for {
          scriptIdValidated <- ObjectId.parse(scriptId)
          _ <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound" ~> NOT_FOUND
        } yield ()
      case _ => Fox.successful(())
    }

  private def createTaskWithoutAnnotationBase(
      paramBox: Box[TaskParameters],
      skeletonTracingIdBox: Box[Option[String]],
      volumeTracingIdBox: Box[Option[String]])(implicit request: SecuredRequest[WkEnv, _]): Fox[Task] =
    for {
      params <- paramBox.toFox
      skeletonIdOpt <- skeletonTracingIdBox.toFox
      volumeIdOpt <- volumeTracingIdBox.toFox
      _ <- bool2Fox(skeletonIdOpt.isDefined || volumeIdOpt.isDefined) ?~> "task.create.needsEitherSkeletonOrVolume"
      taskTypeIdValidated <- ObjectId.parse(params.taskTypeId)
      project <- projectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName) ~> NOT_FOUND
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

  def update(taskId: String) = sil.SecuredAction.async(validateJson[TaskParameters]) { implicit request =>
    val params = request.body
    for {
      taskIdValidated <- ObjectId.parse(taskId) ?~> "task.id.invalid"
      task <- taskDAO.findOne(taskIdValidated) ?~> "task.notFound" ~> NOT_FOUND
      project <- projectDAO.findOne(task._project)
      _ <- Fox
        .assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
      _ <- taskDAO.updateTotalInstances(task._id, task.totalInstances + params.openInstances - task.openInstances)
      updatedTask <- taskDAO.findOne(taskIdValidated)
      json <- taskService.publicWrites(updatedTask)
    } yield {
      JsonOk(json, Messages("task.editSuccess"))
    }
  }

  def delete(taskId: String) = sil.SecuredAction.async { implicit request =>
    for {
      taskIdValidated <- ObjectId.parse(taskId) ?~> "task.id.invalid"
      task <- taskDAO.findOne(taskIdValidated) ?~> "task.notFound" ~> NOT_FOUND
      project <- projectDAO.findOne(task._project)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> Messages(
        "notAllowed")
      _ <- taskDAO.removeOneAndItsAnnotations(task._id) ?~> "task.remove.failed"
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def listTasksForType(taskTypeId: String) = sil.SecuredAction.async { implicit request =>
    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId) ?~> "taskType.id.invalid"
      tasks <- taskDAO.findAllByTaskType(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
      js <- Fox.serialCombined(tasks)(taskService.publicWrites(_))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listTasks = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      userIdOpt <- Fox.runOptional((request.body \ "user").asOpt[String])(ObjectId.parse)
      projectNameOpt = (request.body \ "project").asOpt[String]
      taskIdsOpt <- Fox.runOptional((request.body \ "ids").asOpt[List[String]])(ids =>
        Fox.serialCombined(ids)(ObjectId.parse))
      taskTypeIdOpt <- Fox.runOptional((request.body \ "taskType").asOpt[String])(ObjectId.parse)
      randomizeOpt = (request.body \ "random").asOpt[Boolean]
      tasks <- taskDAO.findAllByProjectAndTaskTypeAndIdsAndUser(projectNameOpt,
                                                                taskTypeIdOpt,
                                                                taskIdsOpt,
                                                                userIdOpt,
                                                                randomizeOpt)
      jsResult <- Fox.serialCombined(tasks)(taskService.publicWrites(_))
    } yield {
      Ok(Json.toJson(jsResult))
    }
  }

  def request = sil.SecuredAction.async { implicit request =>
    log {
      val user = request.identity
      for {
        teams <- getAllowedTeamsForNextTask(user)
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(user, user._organization)
        (task, initializingAnnotationId) <- taskDAO
          .assignNext(user._id, teams, isTeamManagerOrAdmin) ?~> "task.unavailable"
        insertedAnnotationBox <- annotationService.createAnnotationFor(user, task, initializingAnnotationId).futureBox
        _ <- annotationService.abortInitializedAnnotationOnFailure(initializingAnnotationId, insertedAnnotationBox)
        annotation <- insertedAnnotationBox.toFox
        annotationJSON <- annotationService.publicWrites(annotation, Some(user))
      } yield {
        JsonOk(annotationJSON, Messages("task.assigned"))
      }
    }
  }

  private def getAllowedTeamsForNextTask(user: User)(implicit ctx: DBAccessContext,
                                                     m: MessagesProvider): Fox[List[ObjectId]] =
    (for {
      numberOfOpen <- annotationService.countOpenNonAdminTasks(user)
    } yield {
      if (user.isAdmin) {
        teamDAO.findAllIdsByOrganization(user._organization)
      } else if (numberOfOpen < MAX_OPEN_TASKS) {
        userService.teamIdsFor(user._id)
      } else {
        (for {
          teamManagerTeamIds <- userService.teamManagerTeamIdsFor(user._id)
        } yield {
          if (teamManagerTeamIds.nonEmpty) {
            Fox.successful(teamManagerTeamIds)
          } else {
            Fox.failure(Messages("task.tooManyOpenOnes"))
          }
        }).flatten
      }
    }).flatten

  private def isVolumeOrHybridTaskType(taskParameters: List[TaskParameters])(implicit ctx: DBAccessContext) =
    Fox
      .serialCombined(taskParameters) { param =>
        for {
          taskTypeIdValidated <- ObjectId.parse(param.taskTypeId) ?~> "taskType.id.invalid"
          taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
        } yield taskType.tracingType == TracingType.volume || taskType.tracingType == TracingType.hybrid
      }
      .map(_.exists(_ == true))

  def peekNext = sil.SecuredAction.async { implicit request =>
    val user = request.identity
    for {
      teamIds <- userService.teamIdsFor(user._id)
      isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(user, user._organization)
      task <- taskDAO.peekNextAssignment(user._id, teamIds, isTeamManagerOrAdmin) ?~> "task.unavailable"
      taskJson <- taskService.publicWrites(task)(GlobalAccessContext)
    } yield Ok(taskJson)
  }

  def listExperienceDomains = sil.SecuredAction.async { implicit request =>
    for {
      experienceDomains <- taskDAO.listExperienceDomains
    } yield Ok(Json.toJson(experienceDomains))
  }
}
