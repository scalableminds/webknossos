package controllers

import collections.SequenceUtils

import java.io.File
import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits

import javax.inject.Inject
import models.annotation._
import models.annotation.nml.NmlResults.TracingBoxContainer
import models.project.ProjectDAO
import models.task._
import models.user._
import net.liftweb.common.{Box, Full}
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId
import models.dataset.DatasetDAO

import scala.concurrent.ExecutionContext

class TaskController @Inject()(taskCreationService: TaskCreationService,
                               annotationService: AnnotationService,
                               projectDAO: ProjectDAO,
                               taskTypeDAO: TaskTypeDAO,
                               userService: UserService,
                               taskDAO: TaskDAO,
                               datasetDAO: DatasetDAO,
                               taskService: TaskService,
                               nmlService: AnnotationUploadService,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with ProtoGeometryImplicits
    with FoxImplicits {

  def read(taskId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      task <- taskDAO.findOne(taskId) ?~> "task.notFound" ~> NOT_FOUND
      js <- taskService.publicWrites(task)
    } yield Ok(js)
  }

  def create: Action[List[TaskParameters]] =
    sil.SecuredAction.async(validateJson[List[TaskParameters]]) { implicit request =>
      for {
        _ <- bool2Box(request.body.nonEmpty) ?~> "task.create.noTasks"
        taskTypeId <- SequenceUtils.findUniqueElement(request.body.map(_.taskTypeId)) ?~> "task.create.notOnSameTaskType"
        taskType <- taskTypeDAO.findOne(taskTypeId) ?~> "taskType.notFound"
        datasetId <- SequenceUtils.findUniqueElement(request.body.map(_.datasetId)) ?~> "task.create.notOnSameDataset"
        dataset <- datasetDAO.findOne(datasetId) ?~> Messages("dataset.notFound", datasetId)
        _ <- bool2Fox(dataset._organization == request.identity._organization) ?~> "task.create.datasetOfOtherOrga"
        _ <- taskCreationService.assertBatchLimit(request.body.length, taskType)
        taskParametersWithIds = taskCreationService.addNewIdsToTaskParameters(request.body, taskType)
        taskParametersFull <- taskCreationService.createTracingsFromBaseAnnotations(taskParametersWithIds,
                                                                                    taskType,
                                                                                    dataset)
        skeletonBaseOpts: List[Option[SkeletonTracing]] = taskCreationService.createTaskSkeletonTracingBases(
          taskParametersFull)
        volumeBaseOpts: List[Option[(VolumeTracing, Option[File])]] <- taskCreationService.createTaskVolumeTracingBases(
          taskParametersFull,
          taskType)
        paramsWithTracings = taskParametersFull.lazyZip(skeletonBaseOpts).lazyZip(volumeBaseOpts).map {
          case (params, skeletonOpt, volumeOpt) => Full((params, skeletonOpt, volumeOpt))
        }
        result <- taskCreationService.createTasks(paramsWithTracings, taskType, request.identity)
      } yield Ok(Json.toJson(result))
    }

  /* Create new tasks from existing annotation files
    Expects:
     - As Form data:
       - taskTypeId (string) id of the task type to be used for the new tasks
       - neededExperience (Experience) experience domain and level that selects which users can get the new tasks
       - pendingInstances (int) if greater than one, multiple instances of the task will be given to users to annotate
       - projectName (string) name of the project the task should be part of
       - scriptId (string, optional) id of a user script that should be loaded for the annotators of the new tasks
       - boundingBox (BoundingBox, optional) limit the bounding box where the annotators should be active
     - As File attachment
       - A zip file containing base annotations (each either NML or zip with NML + volume) for the new tasks. One task will be created per annotation.
   */
  def createFromFiles: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      body <- request.body.asMultipartFormData ?~> "binary.payload.invalid"
      inputFiles = body.files.filter(file =>
        file.filename.toLowerCase.endsWith(".nml") || file.filename.toLowerCase.endsWith(".zip"))
      _ <- bool2Fox(inputFiles.nonEmpty) ?~> "nml.file.notFound"
      jsonString <- body.dataParts.get("formJSON").flatMap(_.headOption) ?~> "format.json.missing"
      params <- JsonHelper.parseAndValidateJson[NmlTaskParameters](jsonString) ?~> "task.create.failed"
      userOrganizationId = request.identity._organization
      taskType <- taskTypeDAO.findOne(params.taskTypeId) ?~> "taskType.notFound" ~> NOT_FOUND
      _ <- taskCreationService.assertBatchLimit(inputFiles.length, taskType)
      project <- projectDAO
        .findOneByNameAndOrganization(params.projectName, request.identity._organization) ?~> "project.notFound" ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
      extractedFiles <- nmlService.extractFromFiles(
        inputFiles.map(f => (f.ref.path.toFile, f.filename)),
        SharedParsingParameters(useZipName = false, isTaskUpload = true, userOrganizationId = userOrganizationId))
      extractedTracingBoxesRaw: List[TracingBoxContainer] = extractedFiles.toBoxes
      extractedTracingBoxes: List[TracingBoxContainer] <- taskCreationService.addVolumeFallbackBoundingBoxes(
        extractedTracingBoxesRaw)
      fullParams: List[Box[TaskParameters]] = taskCreationService.buildFullParamsFromFiles(params,
                                                                                           extractedTracingBoxes)
      fullParamsWithIds = taskCreationService.addNewIdsToTaskParametersBoxed(fullParams, taskType)
      (skeletonBases, volumeBases) <- taskCreationService.fillInMissingTracings(
        extractedTracingBoxes.map(_.skeleton),
        extractedTracingBoxes.map(_.volume),
        fullParamsWithIds,
        taskType
      )

      fullParamsWithTracings = taskCreationService.combineParamsWithTracings(fullParamsWithIds,
                                                                             skeletonBases,
                                                                             volumeBases)
      result <- taskCreationService.createTasks(fullParamsWithTracings, taskType, request.identity)
    } yield Ok(Json.toJson(result))
  }

  def update(taskId: ObjectId): Action[TaskParameters] =
    sil.SecuredAction.async(validateJson[TaskParameters]) { implicit request =>
      val params = request.body
      for {
        task <- taskDAO.findOne(taskId) ?~> "task.notFound" ~> NOT_FOUND
        project <- projectDAO.findOne(task._project)
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
        _ <- taskDAO.updateTotalInstances(task._id,
                                          task.totalInstances + params.pendingInstances - task.pendingInstances)
        updatedTask <- taskDAO.findOne(taskId)
        json <- taskService.publicWrites(updatedTask)
      } yield JsonOk(json, Messages("task.editSuccess"))
    }

  def delete(taskId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      task <- taskDAO.findOne(taskId) ?~> "task.notFound" ~> NOT_FOUND
      project <- projectDAO.findOne(task._project)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed"
      _ <- taskDAO.removeOneAndItsAnnotations(task._id) ?~> "task.remove.failed"
    } yield JsonOk(Messages("task.removed"))
  }

  def listTasksForType(taskTypeId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      tasks <- taskDAO.findAllByTaskType(taskTypeId) ?~> "taskType.notFound" ~> NOT_FOUND
      js <- Fox.serialCombined(tasks)(taskService.publicWrites(_))
    } yield Ok(Json.toJson(js))
  }

  def listTasks: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      userIdOpt <- Fox.runOptional((request.body \ "user").asOpt[String])(ObjectId.fromString)
      projectIdOpt <- Fox.runOptional((request.body \ "project").asOpt[String])(ObjectId.fromString)
      taskIdsOpt <- Fox.runOptional((request.body \ "ids").asOpt[List[String]])(ids =>
        Fox.serialCombined(ids)(ObjectId.fromString))
      taskTypeIdOpt <- Fox.runOptional((request.body \ "taskType").asOpt[String])(ObjectId.fromString)
      randomizeOpt = (request.body \ "random").asOpt[Boolean]
      tasks <- taskDAO.findAllByProjectAndTaskTypeAndIdsAndUser(projectIdOpt,
                                                                taskTypeIdOpt,
                                                                taskIdsOpt,
                                                                userIdOpt,
                                                                randomizeOpt)
      jsResult <- Fox.serialCombined(tasks)(taskService.publicWrites(_))
    } yield Ok(Json.toJson(jsResult))
  }

  def request: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    log() {
      val user = request.identity
      for {
        teams <- taskService.getAllowedTeamsForNextTask(user)
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(user, user._organization)
        (taskId, initializingAnnotationId) <- taskDAO
          .assignNext(user._id, teams, isTeamManagerOrAdmin) ?~> "task.unavailable"
        insertedAnnotationBox <- annotationService.createAnnotationFor(user, taskId, initializingAnnotationId).futureBox
        _ <- annotationService.abortInitializedAnnotationOnFailure(initializingAnnotationId, insertedAnnotationBox)
        annotation <- insertedAnnotationBox.toFox
        annotationJSON <- annotationService.publicWrites(annotation, Some(user))
      } yield JsonOk(annotationJSON, Messages("task.assigned"))
    }
  }

  def assignOne(id: ObjectId, userId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    log() {
      for {
        assignee <- userService.findOneCached(userId)
        teams <- userService.teamIdsFor(userId)
        task <- taskDAO.findOne(id)
        project <- projectDAO.findOne(task._project)
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed"
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, assignee)) ?~> "notAllowed"
        (_, initializingAnnotationId) <- taskDAO.assignOneTo(id, userId, teams) ?~> "task.unavailable"
        insertedAnnotationBox <- annotationService.createAnnotationFor(assignee, id, initializingAnnotationId).futureBox
        _ <- annotationService.abortInitializedAnnotationOnFailure(initializingAnnotationId, insertedAnnotationBox)
        _ <- insertedAnnotationBox.toFox
        taskUpdated <- taskDAO.findOne(id)
        taskJson <- taskService.publicWrites(taskUpdated)(GlobalAccessContext)
      } yield Ok(taskJson)
    }
  }

  def peekNext: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    val user = request.identity
    for {
      teamIds <- userService.teamIdsFor(user._id)
      isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(user, user._organization)
      task <- taskDAO.peekNextAssignment(user._id, teamIds, isTeamManagerOrAdmin) ?~> "task.unavailable"
      taskJson <- taskService.publicWrites(task)(GlobalAccessContext)
    } yield Ok(taskJson)
  }

  def listExperienceDomains: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      experienceDomains <- taskDAO.listExperienceDomains(request.identity._organization)
    } yield Ok(Json.toJson(experienceDomains))
  }
}
