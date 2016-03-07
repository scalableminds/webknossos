package controllers

import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import models.binary.DataSetDAO
import javax.inject.Inject
import net.liftweb.common.{Box, Failure, Full}
import oxalis.nml.NMLService
import play.api.Logger
import play.api.libs.json.Json._
import oxalis.security.{AuthenticatedRequest, Secured}
import models.user._
import models.task._
import models.annotation._
<<<<<<< HEAD
=======
import reactivemongo.core.commands.LastError
import views._
import play.api.libs.concurrent._
>>>>>>> 777b966dea8460009c7c78dfd25fd855a0f7da08
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.{MessagesApi, Messages}
import models.annotation.AnnotationService
import play.api.Play.current
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import com.scalableminds.util.reactivemongo.DBAccessContext
import play.api.mvc.{Result, AnyContent}
import play.twirl.api.Html
import scala.concurrent.Future
import play.api.libs.json._
import play.api.libs.functional.syntax._
import reactivemongo.bson.BSONObjectID

class TaskController @Inject() (val messagesApi: MessagesApi) extends Controller with Secured with FoxImplicits {

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 2

  val baseJsonReads =
      (__ \ 'taskTypeId).read[String] and
      (__ \ 'neededExperience).read[Experience] and
      (__ \ 'priority).read[Int] and
      (__ \ 'status).read[CompletionStatus] and
      (__ \ 'team).read[String] and
      (__ \ 'projectName).readNullable[String] and
      (__ \ 'boundingBox).readNullable[BoundingBox]

  val taskNMLJsonReads = baseJsonReads.tupled

  val taskCompleteReads =
    (baseJsonReads and
      (__ \ 'dataSet).read[String] and
      (__ \ 'editPosition).read[Point3D]).tupled

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def read(taskId: String) = Authenticated.async{ implicit request =>
    for{
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      js <- Task.transformToJson(task)
    } yield {
      Ok(js)
    }
  }

  def createFromNML(implicit request: AuthenticatedRequest[AnyContent]) = {
    def parseJson(s: String) = {
      Json.parse(s).validate(taskNMLJsonReads) match {
        case JsSuccess(parsed, _) =>
          Full(parsed)
        case errors: JsError =>
          Failure(Messages("task.create.failed"))
      }
    }

    for{
      body <- request.body.asMultipartFormData ?~> Messages("invalid")
      nmlFile <- body.file("nmlFile") ?~> Messages("nml.file.notFound")
      stringifiedJson <- body.dataParts.get("formJSON").flatMap(_.headOption) ?~> Messages("format.json.missing")
      (taskTypeId, experience, priority, status, team, projectName, boundingBox) <- parseJson(stringifiedJson).toFox
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
      _ <- ensureTeamAdministration(request.user, team)
      result <- {
        val nmls = NMLService.extractFromFile(nmlFile.ref.file, nmlFile.filename)

        val results = nmls.map {
          case NMLService.NMLParseSuccess(_, nml)          =>
            val task = Task(
              taskType._id,
              team,
              experience,
              priority,
              status.open,
              _project = project.map(_.name),
              _id = BSONObjectID.generate)

            for{
              _ <- TaskDAO.insert(task)
              _ <- AnnotationService.createAnnotationBase(task, request.user._id, boundingBox, taskType.settings, nml)
            } yield Messages("task.create.success")

          case NMLService.NMLParseFailure(fileName, error) =>
            Fox.failure(Messages("nml.file.invalid", fileName, error))
        }
        bulk2StatusJson(results).map(js => JsonOk(js, Messages("task.bulk.processed")))
      }
    } yield result
  }

  def createSingleTask(input: (String, Experience, Int, CompletionStatus, String, Option[String], Option[BoundingBox], String, Point3D))(implicit request: AuthenticatedRequest[_]) =
    input match {
      case (taskTypeId, experience, priority, status, team, projectName, boundingBox, dataSetName, start) =>
        for {
          _ <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
          taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
          project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
          _ <- ensureTeamAdministration(request.user, team)
          task = Task(taskType._id, team, experience, priority, status.open, _project = project.map(_.name))
          _ <- TaskDAO.insert(task)
          _ <- AnnotationService.createAnnotationBase(task, request.user._id, boundingBox, taskType.settings, dataSetName, start)
        } yield {
          task
        }
    }

  def bulkCreate(json: JsValue)(implicit request: AuthenticatedRequest[_]): Fox[Result] = {
    withJsonUsing(json, Reads.list(taskCompleteReads)){ parsed =>
      val results = parsed.map(p => createSingleTask(p).map(_ => Messages("task.create.success")))
      bulk2StatusJson(results).map(js => JsonOk(js, Messages("task.bulk.processed")))
    }
  }

  def create(`type`: String = "default") = Authenticated.async{ implicit request =>
    `type` match {
      case "default" =>
        request.body.asJson.toFox.flatMap{json =>
          withJsonUsing(json, taskCompleteReads){ parsed =>
            for{
              task <- createSingleTask(parsed)
              json <- Task.transformToJson(task)
            } yield JsonOk(json, Messages("task.create.success"))
          }
        }.getOrElse(JsonBadRequest(Messages("format.json.invalid")))
      case "nml" =>
        createFromNML(request)
      case "bulk" =>
        request.body.asJson
        .toFox
        .flatMap(json => bulkCreate(json))
        .getOrElse(JsonBadRequest(Messages("format.json.invalid")))
    }
  }

  def update(taskId: String) = Authenticated.async(parse.json) { implicit request =>
    withJsonBodyUsing(taskCompleteReads){
      case (taskTypeId, experience, priority, status, team, projectName, boundingBox, dataSetName, start) =>
        for {
          task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
          _ <- ensureTeamAdministration(request.user, task.team)
          taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
          project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")

          updatedTask <- TaskDAO.update(
            _task = task._id,
            _taskType = taskType._id,
            neededExperience = experience,
            priority = priority,
            instances = status.open + task.assignedInstances,
            team = team,
            _project = project.map(_.name))
          _ <- AnnotationService.updateAllOfTask(updatedTask, team, dataSetName, boundingBox, taskType.settings)
          _ <- AnnotationService.updateAnnotationBase(updatedTask, start)
          json <- Task.transformToJson(updatedTask)
        } yield {
          JsonOk(json, Messages("task.editSuccess"))
        }
    }
  }

  def delete(taskId: String) = Authenticated.async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- TaskService.remove(task._id)
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def list = Authenticated.async{ implicit request =>
    for {
      tasks <- TaskService.findAllAdministratable(request.user)
      js <- Future.traverse(tasks)(Task.transformToJson)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listTasksForType(taskTypeId: String) = Authenticated.async { implicit request =>
    for {
      tasks <- TaskService.findAllByTaskType(taskTypeId)
      js <- Future.traverse(tasks)(Task.transformToJson)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def ensureMaxNumberOfOpenTasks(user: User)(implicit ctx: DBAccessContext): Fox[Int] = {
    AnnotationService.countOpenTasks(user).flatMap{ numberOfOpen =>
      if (numberOfOpen < MAX_OPEN_TASKS)
        Fox.successful(numberOfOpen)
      else
        Fox.failure(Messages("task.tooManyOpenOnes"))
    }
  }

<<<<<<< HEAD
=======
  def requestAssignmentFor(user: User)(implicit ctx: DBAccessContext) =
    TaskService.findAssignableFor(user)

  def getAvailableTasksFor(user: User)(implicit ctx: DBAccessContext): Fox[List[Task]] =
    TaskService.allNextTasksForUser(user)

  def getProjectsFor(tasks: List[Task])(implicit ctx: DBAccessContext): Future[List[Project]] =
    Fox.sequenceOfFulls(tasks.map(_.project)).map(_.distinct)

  def getAllAvailableTaskCountsAndProjects()(implicit ctx: DBAccessContext): Fox[Map[User, (Int, List[Project])]] = {
    UserDAO.findAllNonAnonymous
      .flatMap { users =>
        Future.sequence( users.map { user =>
          async {
            val tasks = await(getAvailableTasksFor(user).futureBox) openOr List()
            val taskCount = tasks.size
            val projects = await(getProjectsFor(tasks))
            user -> (taskCount, projects)
          }
        })
      }
      .map(_.toMap[User, (Int, List[Project])])
  }

>>>>>>> 777b966dea8460009c7c78dfd25fd855a0f7da08
  def createAvailableTasksJson(availableTasksMap: Map[User, (Int, List[Project])]) =
    Json.toJson(availableTasksMap.map { case (user, (taskCount, projects)) =>
      Json.obj(
        "name" -> user.name,
        "availableTaskCount" -> taskCount,
        "projects" -> projects.map(_.name)
      )
    })

  def requestAvailableTasks = Authenticated.async { implicit request =>
    for {
      availableTasksMap <- TaskService.getAllAvailableTaskCountsAndProjects()
    } yield {
      Ok(createAvailableTasksJson(availableTasksMap))
    }
  }

  def tryToGetNextAssignmentFor(user: User, retryCount: Int = 5)(implicit ctx: DBAccessContext): Fox[OpenAssignment] = {
    (requestAssignmentFor(user) ?~> Messages("task.unavailable")).flatMap { assignment =>
      OpenAssignmentService.remove(assignment).flatMap { removeResult =>
        if (removeResult.n >= 1)
          Fox.successful(assignment)
        else if (retryCount > 0)
          tryToGetNextAssignmentFor(user, retryCount - 1)
        else
          Fox.failure(Messages("task.unavailable"))
      }
    }
  }

  def request = Authenticated.async { implicit request =>
    val user = request.user
    for {
      _ <- ensureMaxNumberOfOpenTasks(user)
<<<<<<< HEAD
      task <- TaskService.nextTaskForUser(user) ?~> Messages("task.unavailable")
=======
      assignment <- tryToGetNextAssignmentFor(user)
      task <- assignment.task
>>>>>>> 777b966dea8460009c7c78dfd25fd855a0f7da08
      annotation <- AnnotationService.createAnnotationFor(user, task) ?~> Messages("annotation.creationFailed")
      annotationJSON <- AnnotationLike.annotationLikeInfoWrites(annotation, Some(user), exclude = List("content", "actions"))
    } yield {
      JsonOk(annotationJSON, Messages("task.assigned"))
    }
  }
}
