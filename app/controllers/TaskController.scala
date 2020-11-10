package controllers

import java.io.File

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.mvc.ResultBox
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.tracingstore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings.ProtoGeometryImplicits
import javax.inject.Inject
import models.annotation._
import models.annotation.nml.NmlService
import models.project.ProjectDAO
import models.task._
import models.user._
import net.liftweb.common.{Box, Empty, Failure, Full}
import oxalis.security.WkEnv
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.ObjectId

import scala.concurrent.ExecutionContext

class TaskController @Inject()(taskCreationService: TaskCreationService,
                               annotationService: AnnotationService,
                               projectDAO: ProjectDAO,
                               taskTypeDAO: TaskTypeDAO,
                               userService: UserService,
                               taskDAO: TaskDAO,
                               taskService: TaskService,
                               nmlService: NmlService,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with ResultBox
    with ProtoGeometryImplicits
    with FoxImplicits {

  def read(taskId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      task <- taskDAO.findOne(ObjectId(taskId)) ?~> "task.notFound" ~> NOT_FOUND
      js <- taskService.publicWrites(task)
    } yield {
      Ok(js)
    }
  }

  def create: Action[List[TaskParameters]] = sil.SecuredAction.async(validateJson[List[TaskParameters]]) {
    implicit request =>
      for {
        _ <- taskCreationService.assertBatchLimit(request.body.length, request.body.map(_.taskTypeId))
        taskParameters <- taskCreationService.duplicateAllBaseTracings(request.body, request.identity._organization)
        skeletonBaseOpts: List[Option[SkeletonTracing]] <- taskCreationService.createTaskSkeletonTracingBases(
          taskParameters)
        volumeBaseOpts: List[Option[(VolumeTracing, Option[File])]] <- taskCreationService
          .createTaskVolumeTracingBases(taskParameters, request.identity._organization)
        result <- taskCreationService.createTasks((taskParameters, skeletonBaseOpts, volumeBaseOpts).zipped.map {
          case (params, skeletonOpt, volumeOpt) => Full((params, skeletonOpt, volumeOpt))
        })
      } yield Ok(Json.toJson(result))
  }

  @SuppressWarnings(Array("OptionGet")) // We can safely call get on the Option because we check that one of the failures is defined
  def createFromFiles: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      body <- request.body.asMultipartFormData ?~> "binary.payload.invalid"
      inputFiles = body.files.filter(file =>
        file.filename.toLowerCase.endsWith(".nml") || file.filename.toLowerCase.endsWith(".zip"))
      _ <- bool2Fox(inputFiles.nonEmpty) ?~> "nml.file.notFound"
      jsonString <- body.dataParts.get("formJSON").flatMap(_.headOption) ?~> "format.json.missing"
      params <- JsonHelper.parseJsonToFox[NmlTaskParameters](jsonString) ?~> "task.create.failed"
      _ <- taskCreationService.assertBatchLimit(inputFiles.length, List(params.taskTypeId))
      taskTypeIdValidated <- ObjectId.parse(params.taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
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
          taskCreationService.buildFullParamsFromFiles(params,
                                                       skeletonBox,
                                                       volumeBox.map(_._1),
                                                       s.map(_.fileName),
                                                       s.map(_.description))
      }
      (skeletonBases, volumeBases) <- taskCreationService.fillInMissingTracingBases(skeletonBaseBoxes,
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

      result <- taskCreationService.createTasks(taskParams)
    } yield {
      Ok(Json.toJson(result))
    }
  }

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
        teams <- taskService.getAllowedTeamsForNextTask(user)
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
