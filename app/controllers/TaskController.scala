package controllers

import javax.inject.Inject

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.mvc.ResultBox
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.tracings.{ProtoGeometryImplicits, TracingReference}
import models.annotation.nml.NmlService
import models.annotation.{AnnotationDAO, AnnotationService, AnnotationType}
import models.binary.DataSetDAO
import models.project.ProjectDAO
import models.task._
import models.user._
import net.liftweb.common.Box
import oxalis.security.WebknossosSilhouette.{SecuredAction, SecuredRequest}
import play.api.Play.current
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.mvc.Result

import scala.concurrent.Future

case class TaskParameters(
                           taskTypeId: String,
                           neededExperience: Experience,
                           openInstances: Int,
                           team: String,
                           projectName: String,
                           scriptId: Option[String],
                           boundingBox: Option[BoundingBox],
                           dataSet: String,
                           editPosition: Point3D,
                           editRotation: Vector3D)

object TaskParameters {
  implicit val taskParametersFormat = Json.format[TaskParameters]
}

case class NmlTaskParameters(
                              taskTypeId: String,
                              neededExperience: Experience,
                              openInstances: Int,
                              team: String,
                              projectName: String,
                              scriptId: Option[String],
                              boundingBox: Option[BoundingBox])

object NmlTaskParameters {
  implicit val nmlTaskParametersFormat = Json.format[NmlTaskParameters]
}

class TaskController @Inject() (val messagesApi: MessagesApi) extends Controller with ResultBox with ProtoGeometryImplicits with FoxImplicits {

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 2

  def read(taskId: String) = SecuredAction.async { implicit request =>
    for {
      task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
      js <- Task.transformToJson(task)
    } yield {
      Ok(js)
    }
  }


  def create = SecuredAction.async(validateJson[List[TaskParameters]]) { implicit request =>
    createTasks(request.body.map { params =>
      val tracing = AnnotationService.createTracingBase(params.dataSet, params.boundingBox, params.editPosition, params.editRotation)
      (params, tracing)
    })
  }

  def createFromFile = SecuredAction.async {implicit request =>

    for {
      body <- request.body.asMultipartFormData ?~> Messages("invalid")
      inputFile <- body.file("nmlFile[]") ?~> Messages("nml.file.notFound")
      jsonString <- body.dataParts.get("formJSON").flatMap(_.headOption) ?~> Messages("format.json.missing")
      params <- JsonHelper.parseJsonToFox[NmlTaskParameters](jsonString) ?~> Messages("task.create.failed")
      taskType <- TaskTypeDAO.findOneById(params.taskTypeId) ?~> Messages("taskType.notFound")
      project <- ProjectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- ensureTeamAdministration(request.identity, params.team)

      parseResults: List[NmlService.NmlParseResult] = NmlService.extractFromFile(inputFile.ref.file, inputFile.filename).parseResults
      tracingFoxes = parseResults.map(parseResultToSkeletonTracingFox)
      tracings <- Fox.combined(tracingFoxes) ?~> Messages("task.create.failed")
      result <- createTasks(tracings.map(t => (buildFullParams(params, t), t)))
    } yield {
      result
    }
  }

  private def parseResultToSkeletonTracingFox(parseResult: NmlService.NmlParseResult): Fox[SkeletonTracing] = parseResult match {
    case NmlService.NmlParseFailure(fileName, error) =>
      Fox.failure(Messages("nml.file.invalid", fileName, error))
    case NmlService.NmlParseSuccess(fileName, (Left(skeletonTracing), description)) =>
      Fox.successful(skeletonTracing)
    case _ =>
      Fox.failure(Messages("nml.file.invalid"))
  }

  private def buildFullParams(nmlParams: NmlTaskParameters, tracing: SkeletonTracing) = {
    TaskParameters(
      nmlParams.taskTypeId,
      nmlParams.neededExperience,
      nmlParams.openInstances,
      nmlParams.team,
      nmlParams.projectName,
      nmlParams.scriptId,
      nmlParams.boundingBox,
      tracing.dataSetName,
      tracing.editPosition,
      tracing.editRotation)
  }

  def createTasks(requestedTasks: List[(TaskParameters, SkeletonTracing)])(implicit request: SecuredRequest[_]): Fox[Result] = {
    def assertAllOnSameDataset(): Fox[String] = {
      def allOnSameDatasetIter(requestedTasksRest: List[(TaskParameters, SkeletonTracing)], dataSetName: String): Boolean = {
        requestedTasksRest match {
          case List() => true
          case head :: tail => head._1.dataSet == dataSetName && allOnSameDatasetIter(tail, dataSetName)
        }
      }

      val firstDataSetName = requestedTasks.head._1.dataSet
      if (allOnSameDatasetIter(requestedTasks, requestedTasks.head._1.dataSet))
        Fox.successful(firstDataSetName)
      else
        Fox.failure("Cannot create tasks on multiple datasets in one go.")
    }

    for {
      dataSetName <- assertAllOnSameDataset()
      dataSet <- DataSetDAO.findOneBySourceName(requestedTasks.head._1.dataSet) ?~> Messages("dataSet.notFound", dataSetName)
      tracingReferences: List[Box[TracingReference]] <- dataSet.dataStore.saveSkeletonTracings(SkeletonTracings(requestedTasks.map(_._2)))
      taskObjects: List[Fox[Task]] = requestedTasks.map(r => createTaskWithoutAnnotationBase(r._1))
      zipped = (requestedTasks, tracingReferences, taskObjects).zipped.toList
      annotationBases = zipped.map(tuple => AnnotationService.createAnnotationBase(
        taskFox = tuple._3,
        request.identity._id,
        tracingReferenceBox = tuple._2,
        dataSetName))
      zippedTasksAndAnnotations = taskObjects zip annotationBases
      taskJsons = zippedTasksAndAnnotations.map(tuple => Task.transformToJsonFoxed(tuple._1, tuple._2))
      result <- {
        val taskJsonFuture: Future[List[Box[JsObject]]] = Fox.sequence(taskJsons)
        taskJsonFuture.map { taskJsonBoxes =>
          bulk2StatusJson(taskJsonBoxes)
        }
      }
    } yield Ok(Json.toJson(result))
  }

  private def validateScript(scriptIdOpt: Option[String])(implicit request: SecuredRequest[_]): Fox[Unit] = {
    scriptIdOpt match {
      case Some(scriptId) =>
        for {
          _ <- ScriptDAO.findOneById(scriptId) ?~> Messages("script.notFound")
        } yield ()
      case _ => Fox.successful(())
    }
  }

  private def createTaskWithoutAnnotationBase(params: TaskParameters)(implicit request: SecuredRequest[_]): Fox[Task] = {
    for {
      taskType <- TaskTypeDAO.findOneById(params.taskTypeId) ?~> Messages("taskType.notFound")
      project <- ProjectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- validateScript(params.scriptId)
      _ <- ensureTeamAdministration(request.identity, params.team)
      task = Task(
        taskType._id,
        params.team,
        params.neededExperience,
        params.openInstances,
        params.openInstances,
        _project = project.name,
        _script = params.scriptId,
        editPosition = params.editPosition,
        editRotation = params.editRotation,
        boundingBox = params.boundingBox.flatMap { box => if (box.isEmpty) None else Some(box) },
        priority = if (project.paused) -1 else project.priority)
      _ <- TaskService.insert(task, project)
    } yield task
  }

  def update(taskId: String) = SecuredAction.async(validateJson[TaskParameters]) { implicit request =>
    val params = request.body
    for {
      task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.identity, task.team) ?~> Messages("notAllowed")
      updatedTask <- TaskDAO.updateInstances(task._id, task.instances + params.openInstances - task.openInstances)
      json <- Task.transformToJson(updatedTask)
    } yield {
      JsonOk(json, Messages("task.editSuccess"))
    }
  }

  def delete(taskId: String) = SecuredAction.async { implicit request =>
    for {
      task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.identity, task.team) ?~> Messages("notAllowed")
      _ <- TaskService.removeOne(task._id)
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def listTasksForType(taskTypeId: String) = SecuredAction.async { implicit request =>
    for {
      tasks <- TaskService.findAllByTaskType(taskTypeId)
      js <- Fox.serialCombined(tasks)(t => Task.transformToJson(t))
    } yield {
      Ok(Json.toJson(js))
    }
  }



  def listTasks = SecuredAction.async(parse.json) { implicit request =>

    val userOpt = (request.body \ "user").asOpt[String]
    val projectOpt = (request.body \ "project").asOpt[String]
    val idsOpt = (request.body \ "ids").asOpt[List[String]]
    val taskTypeOpt = (request.body \ "taskType").asOpt[String]

    userOpt match {
      case Some(userId) => {
        for {
          user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
          userAnnotations <- AnnotationDAO.findActiveAnnotationsFor(user._id, AnnotationType.Task)
          taskIdsFromAnnotations = userAnnotations.flatMap(_._task).map(_.stringify).toSet
          taskIds = idsOpt match {
            case Some(ids) => taskIdsFromAnnotations.intersect(ids.toSet)
            case None => taskIdsFromAnnotations
          }
          tasks <- TaskDAO.findAllByFilterByProjectAndTaskTypeAndIds(projectOpt, taskTypeOpt, Some(taskIds.toList))
          jsResult <- Fox.serialCombined(tasks)(t => Task.transformToJson(t))
        } yield {
          Ok(Json.toJson(jsResult))
        }
      }
      case None => {
        for {
          tasks <- TaskDAO.findAllByFilterByProjectAndTaskTypeAndIds(projectOpt, taskTypeOpt, idsOpt)
          jsResult <- Fox.serialCombined(tasks)(t => Task.transformToJson(t))
        } yield {
          Ok(Json.toJson(jsResult))
        }
      }
    }

  }

  def request = SecuredAction.async { implicit request =>
    val user = request.identity
    for {
      teams <- getAllowedTeamsForNextTask(user)
      _ <- !user.isAnonymous ?~> Messages("user.anonymous.notAllowed")
      task <- tryToGetNextAssignmentFor(user, teams)
      annotation <- AnnotationService.createAnnotationFor(user, task)
      annotationJSON <- annotation.toJson(Some(user))
    } yield {
      JsonOk(annotationJSON, Messages("task.assigned"))
    }
  }


  private def getAllowedTeamsForNextTask(user: User)(implicit ctx: DBAccessContext): Fox[List[String]] = {
    AnnotationService.countOpenNonAdminTasks(user).flatMap { numberOfOpen =>
      if (numberOfOpen < MAX_OPEN_TASKS) {
        Fox.successful(user.teamNames)
      } else if (user.hasAdminAccess) {
        Fox.successful(user.adminTeamNames)
      } else {
        Fox.failure(Messages("task.tooManyOpenOnes"))
      }
    }
  }

  private def tryToGetNextAssignmentFor(user: User, teams: List[String])(implicit ctx: DBAccessContext): Fox[Task] =
    for {
      task <- TaskAssignmentService.findOneAssignableFor(user, teams) ?~> Messages("task.unavailable")
    } yield task

  def peekNext(limit: Int) = SecuredAction.async { implicit request =>
    val user = request.identity
    for {
      tasks <- TaskAssignmentService.findAllAssignableFor(user, user.teamNames, Some(limit))
      tasksJson <- Fox.combined(tasks.map(t => Task.transformToJson(t)(GlobalAccessContext)))
    } yield Ok(Json.toJson(tasksJson))
  }

}
