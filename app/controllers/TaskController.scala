package controllers

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

import scala.concurrent.ExecutionContext

class TaskController @Inject()(taskCreationService: TaskCreationService,
                               annotationService: AnnotationService,
                               projectDAO: ProjectDAO,
                               taskTypeDAO: TaskTypeDAO,
                               userService: UserService,
                               taskDAO: TaskDAO,
                               taskService: TaskService,
                               nmlService: AnnotationUploadService,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with ProtoGeometryImplicits
    with FoxImplicits {

  def read(taskId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      task <- taskDAO.findOne(ObjectId(taskId)) ?~> "task.notFound" ~> NOT_FOUND
      js <- taskService.publicWrites(task)
    } yield Ok(js)
  }

  def create: Action[List[TaskParameters]] =
    sil.SecuredAction.async(validateJson[List[TaskParameters]]) { implicit request =>
      for {
        _ <- taskCreationService.assertBatchLimit(request.body.length, request.body.map(_.taskTypeId))
        taskParameters <- taskCreationService.createTracingsFromBaseAnnotations(request.body,
                                                                                request.identity._organization)
        skeletonBaseOpts: List[Option[SkeletonTracing]] <- taskCreationService.createTaskSkeletonTracingBases(
          taskParameters,
          request.identity._organization)
        volumeBaseOpts: List[Option[(VolumeTracing, Option[File])]] <- taskCreationService.createTaskVolumeTracingBases(
          taskParameters,
          request.identity._organization)
        paramsWithTracings = taskParameters.lazyZip(skeletonBaseOpts).lazyZip(volumeBaseOpts).map {
          case (params, skeletonOpt, volumeOpt) => Full((params, skeletonOpt, volumeOpt))
        }
        result <- taskCreationService.createTasks(paramsWithTracings, request.identity)
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
      _ <- taskCreationService.assertBatchLimit(inputFiles.length, List(params.taskTypeId))
      taskTypeIdValidated <- ObjectId.fromString(params.taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
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
      (skeletonBases, volumeBases) <- taskCreationService.fillInMissingTracings(
        extractedTracingBoxes.map(_.skeleton),
        extractedTracingBoxes.map(_.volume),
        fullParams,
        taskType,
        request.identity._organization
      )

      fullParamsWithTracings = taskCreationService.combineParamsWithTracings(fullParams, skeletonBases, volumeBases)
      result <- taskCreationService.createTasks(fullParamsWithTracings, request.identity)
    } yield Ok(Json.toJson(result))
  }

  def update(taskId: String): Action[TaskParameters] =
    sil.SecuredAction.async(validateJson[TaskParameters]) { implicit request =>
      val params = request.body
      for {
        taskIdValidated <- ObjectId.fromString(taskId) ?~> "task.id.invalid"
        task <- taskDAO.findOne(taskIdValidated) ?~> "task.notFound" ~> NOT_FOUND
        project <- projectDAO.findOne(task._project)
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
        _ <- taskDAO.updateTotalInstances(task._id,
                                          task.totalInstances + params.pendingInstances - task.pendingInstances)
        updatedTask <- taskDAO.findOne(taskIdValidated)
        json <- taskService.publicWrites(updatedTask)
      } yield JsonOk(json, Messages("task.editSuccess"))
    }

  def delete(taskId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      taskIdValidated <- ObjectId.fromString(taskId) ?~> "task.id.invalid"
      task <- taskDAO.findOne(taskIdValidated) ?~> "task.notFound" ~> NOT_FOUND
      project <- projectDAO.findOne(task._project)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed"
      _ <- taskDAO.removeOneAndItsAnnotations(task._id) ?~> "task.remove.failed"
    } yield JsonOk(Messages("task.removed"))
  }

  def listTasksForType(taskTypeId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      taskTypeIdValidated <- ObjectId.fromString(taskTypeId) ?~> "taskType.id.invalid"
      tasks <- taskDAO.findAllByTaskType(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
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

  def assignOne(id: String, userId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    log() {
      for {
        taskIdValidated <- ObjectId.fromString(id)
        userIdValidated <- ObjectId.fromString(userId)
        assignee <- userService.findOneCached(userIdValidated)
        teams <- userService.teamIdsFor(userIdValidated)
        task <- taskDAO.findOne(taskIdValidated)
        project <- projectDAO.findOne(task._project)
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed"
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, assignee)) ?~> "notAllowed"
        (_, initializingAnnotationId) <- taskDAO
          .assignOneTo(taskIdValidated, userIdValidated, teams) ?~> "task.unavailable"
        insertedAnnotationBox <- annotationService
          .createAnnotationFor(assignee, taskIdValidated, initializingAnnotationId)
          .futureBox
        _ <- annotationService.abortInitializedAnnotationOnFailure(initializingAnnotationId, insertedAnnotationBox)
        _ <- insertedAnnotationBox.toFox
        taskUpdated <- taskDAO.findOne(taskIdValidated)
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
