package controllers

import java.util.UUID

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import models.binary.DataSetDAO
import javax.inject.Inject

import com.newrelic.api.agent.NewRelic
import net.liftweb.common.{Box, Failure, Full}
import oxalis.nml.NMLService
import play.api.libs.iteratee.Cont
import play.api.libs.iteratee.{Done, Input, Iteratee}
import play.api.libs.json.Json._
import play.api.libs.json._
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.Json._
import oxalis.security.silhouetteOxalis.{UserAwareAction, UserAwareRequest, SecuredRequest, SecuredAction}
import models.user._
import models.task._
import models.annotation._
import reactivemongo.core.commands.LastError
import views._
import play.api.libs.concurrent._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.{Messages, MessagesApi}
import models.annotation.AnnotationService
import play.api.Play.current
import com.scalableminds.util.tools.{Fox, FoxImplicits, TimeLogger}
import net.liftweb.common.{Box, Empty, Failure, Full}
import com.scalableminds.util.reactivemongo.DBAccessContext
import play.api.mvc.{AnyContent, Result}
import play.twirl.api.Html
import scala.concurrent.Future

import play.api.libs.json._
import play.api.libs.functional.syntax._
import reactivemongo.bson.BSONObjectID
import scala.concurrent.duration._
import scala.async.Async.{async, await}

import models.project.{Project, ProjectDAO}

class TaskController @Inject() (val messagesApi: MessagesApi) extends Controller with FoxImplicits {

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 2

  val baseJsonReads =
    (__ \ 'taskTypeId).read[String] and
      (__ \ 'neededExperience).read[Experience] and
      (__ \ 'status).read[CompletionStatus] and
      (__ \ 'team).read[String] and
      (__ \ 'projectName).read[String] and
      (__ \ 'scriptId).readNullable[String] and
      (__ \ 'boundingBox).readNullable[BoundingBox]

  val taskNMLJsonReads = baseJsonReads.tupled

  val taskCompleteReads =
    (baseJsonReads and
      (__ \ 'dataSet).read[String] and
      (__ \ 'editPosition).read[Point3D] and
      (__ \ 'editRotation).read[Vector3D]).tupled

  def empty = SecuredAction { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def read(taskId: String) = SecuredAction.async { implicit request =>
    for {
      task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
      js <- Task.transformToJson(task, Some(request.identity))
    } yield {
      Ok(js)
    }
  }

  def createFromNML(implicit request: SecuredRequest[AnyContent]) = {
    def parseJson(s: String) = {
      Json.parse(s).validate(taskNMLJsonReads) match {
        case JsSuccess(parsed, _) =>
          Full(parsed)
        case errors: JsError =>
          Failure(Messages("task.create.failed"))
      }
    }

    for {
      body <- request.body.asMultipartFormData ?~> Messages("invalid")
      nmlFile <- body.file("nmlFile") ?~> Messages("nml.file.notFound")
      stringifiedJson <- body.dataParts.get("formJSON").flatMap(_.headOption) ?~> Messages("format.json.missing")
      (taskTypeId, experience, status, team, projectName, scriptId, boundingBox) <- parseJson(stringifiedJson).toFox
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      _ <- ensureTeamAdministration(request.identity, team)
      result <- {
        val nmls = NMLService.extractFromFile(nmlFile.ref.file, nmlFile.filename).nmls

        val futureResult: Future[List[Box[JsObject]]] = Fox.serialSequence(nmls){
          case NMLService.NMLParseSuccess(fileName, nml) =>
            val task = Task(
              taskType._id,
              team,
              experience,
              status.open,
              _project = project.name,
              _script = scriptId,
              creationInfo = Some(fileName),
              _id = BSONObjectID.generate)

            for {
              _ <- TaskService.insert(task, project)
              _ <- AnnotationService.createAnnotationBase(task, request.identity._id, boundingBox, taskType.settings, nml)
              taskjs <- Task.transformToJson(task, Some(request.identity))
            } yield taskjs

          case NMLService.NMLParseFailure(fileName, error) =>
            Fox.failure(Messages("nml.file.invalid", fileName, error))
        }
        futureResult.map { results =>
          val js = bulk2StatusJson(results)
          JsonOk(js, Messages("task.bulk.processed"))
        }
      }
    } yield result
  }


  def createSingleTask(input: (String, Experience, CompletionStatus, String, String, Option[String], Option[BoundingBox], String, Point3D, Vector3D))(implicit request: SecuredRequest[_]) =
    input match {
      case (taskTypeId, experience, status, team, projectName, scriptId, boundingBox, dataSetName, start, rotation) =>
        for {
          _ <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
          taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
          project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
          _ <- ensureTeamAdministration(request.identity, team)
          task = Task(taskType._id, team, experience, status.open, _project = project.name, _script = scriptId)
          _ <- AnnotationService.createAnnotationBase(task, request.identity._id, boundingBox, taskType.settings, dataSetName, start, rotation)
          _ <- TaskService.insert(task, project)
          taskjs <- Task.transformToJson(task, Some(request.identity))
        } yield taskjs
    }

  def bulkCreate(json: JsValue)(implicit request: SecuredRequest[_]): Fox[Result] = {
    withJsonUsing(json, Reads.list(taskCompleteReads)) { parsed =>
      Fox.serialSequence(parsed){p => createSingleTask(p)}.map { results =>
        val js = bulk2StatusJson(results)
        JsonOk(js, Messages("task.bulk.processed"))
      }
    }
  }

  def create(`type`: String = "default") = SecuredAction.async { implicit request =>
    `type` match {
      case "default" =>
        request.body.asJson.toFox.flatMap { json =>
          withJsonUsing(json, taskCompleteReads) { parsed =>
            createSingleTask(parsed).futureBox.map{ result =>
              val js = bulk2StatusJson(List(result))
              JsonOk(js, Messages("task.bulk.processed"))
            }
          }
        }
      case "nml"     =>
        createFromNML(request)
      case "bulk"    =>
        request.body.asJson
        .toFox
        .flatMap(json => bulkCreate(json))
    }
  }

  // TODO: properly handle task update with amazon turk
  def update(taskId: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(taskCompleteReads){
      case (taskTypeId, experience, status, team, projectName, scriptId, boundingBox, dataSetName, start, rotation) =>
        for {
          task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
          _ <- ensureTeamAdministration(request.identity, task.team) ?~> Messages("notAllowed")
          taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
          project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
          openInstanceCount <- task.remainingInstances
          _ <- (status.open == openInstanceCount || project.assignmentConfiguration.supportsChangeOfNumInstances) ?~> Messages("task.instances.changeImpossible")
          updatedTask <- TaskDAO.update(
            _task = task._id,
            _taskType = taskType._id,
            neededExperience = experience,
            instances = task.instances + status.open - openInstanceCount,
            team = team,
            _script = scriptId,
            _project = Some(project.name))
          _ <- AnnotationService.updateAllOfTask(updatedTask, team, dataSetName, boundingBox, taskType.settings)
          _ <- AnnotationService.updateAnnotationBase(updatedTask, start, rotation)
          json <- Task.transformToJson(updatedTask, Some(request.identity))
          _ <- OpenAssignmentService.updateRemainingInstances(updatedTask, project, status.open)
        } yield {
          JsonOk(json, Messages("task.editSuccess"))
        }
    }
  }

  def delete(taskId: String) = SecuredAction.async { implicit request =>
    for {
      task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.identity, task.team) ?~> Messages("notAllowed")
      _ <- TaskService.remove(task._id)
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def list = SecuredAction.async{ implicit request =>
    for {
      tasks <- TaskService.findAllAdministratable(request.identity, limit = 10000)
      js <- Future.traverse(tasks)(t => Task.transformToJson(t, Some(request.identity)))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listTasksForType(taskTypeId: String) = SecuredAction.async { implicit request =>
    for {
      tasks <- TaskService.findAllByTaskType(taskTypeId)
      js <- Future.traverse(tasks)(t => Task.transformToJson(t, Some(request.identity)))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def ensureMaxNumberOfOpenTasks(user: User)(implicit ctx: DBAccessContext): Fox[Int] = {
    AnnotationService.countOpenTasks(user).flatMap{ numberOfOpen =>
      if (numberOfOpen < MAX_OPEN_TASKS || user.hasAdminAccess)
        Fox.successful(numberOfOpen)
      else
        Fox.failure(Messages("task.tooManyOpenOnes"))
    }
  }

  def getProjectsFor(tasks: List[Task])(implicit ctx: DBAccessContext): Future[List[Project]] =
    Fox.serialSequence(tasks)(_.project).map(_.flatten).map(_.distinct)

  def createAvailableTasksJson(availableTasksMap: Map[User, (Int, List[Project])]) =
    Json.toJson(availableTasksMap.map { case (user, (taskCount, projects)) =>
      Json.obj(
        "name" -> user.name,
        "teams" -> user.teamNames,
        "availableTaskCount" -> taskCount,
        "projects" -> projects.map(_.name)
      )
    })

  def requestAvailableTasks = SecuredAction.async { implicit request =>
    // TODO: WORKLOAD CURRENTLY DISABLED DUE TO PERFORMANCE REASONS
    Future.successful(Ok(Json.arr()))
//    for {
//      availableTasksMap <- getAllAvailableTaskCountsAndProjects()
//    } yield {
//      Ok(createAvailableTasksJson(availableTasksMap))
//    }
  }

  def tryToGetNextAssignmentFor(user: User, retryCount: Int = 20)(implicit ctx: DBAccessContext): Fox[OpenAssignment] = {
    val s = System.currentTimeMillis()
    TaskService.findAssignableFor(user).futureBox.flatMap {
      case Full(assignment) =>
        NewRelic.recordResponseTimeMetric("Custom/TaskController/findAssignableFor", System.currentTimeMillis - s)
        TimeLogger.logTimeF("task request", logger.trace(_))(OpenAssignmentService.take(assignment)).flatMap {
          updateResult =>
          if (updateResult.n >= 1)
            Fox.successful(assignment)
          else if (retryCount > 0)
            tryToGetNextAssignmentFor(user, retryCount - 1)
          else {
            val e = System.currentTimeMillis()
            logger.warn(s"Failed to remove any assignment for user ${user.email}. " +
              s"Result: $updateResult n:${updateResult.n} ok:${updateResult.ok} " +
              s"code:${updateResult.code} TOOK: ${e-s}ms")
            Fox.failure(Messages("task.unavailable"))
          }
        }.futureBox
      case f: Failure =>
        logger.warn(s"Failure while trying to getNextTask (u: ${user.email} r: $retryCount): " + f)
        if (retryCount > 0)
          tryToGetNextAssignmentFor(user, retryCount - 1).futureBox
        else {
          logger.warn(s"Failed to retrieve any assignment after all retries (u: ${user.email}) due to FAILURE")
          Fox.failure(Messages("assignment.retrieval.failed")).futureBox
        }
      case Empty =>
        logger.warn(s"Failed to retrieve any assignment after all retries (u: ${user.email}) due to EMPTY")
        Fox.failure(Messages("task.unavailable")).futureBox
    }
  }

  def request = SecuredAction.async { implicit request =>
    val user = request.identity
    val id = UUID.randomUUID().toString
    for {
      _ <- ensureMaxNumberOfOpenTasks(user)
      _ <- !user.isAnonymous ?~> Messages("user.anonymous.notAllowed")
      assignment <- tryToGetNextAssignmentFor(user)
      task <- assignment.task
      annotation <- AnnotationService.createAnnotationFor(user, task) ?~> Messages("annotation.creationFailed")
      annotationJSON <- AnnotationLike.annotationLikeInfoWrites(annotation, Some(user), exclude = List("content"))
    } yield {
      JsonOk(annotationJSON, Messages("task.assigned"))
    }
  }

  def peekNext(limit: Int) = SecuredAction.async { implicit request =>
    val user = request.identity

    def takeUpTo[E](n: Int, filter: (Seq[E], E) => Boolean): Iteratee[E, Seq[E]] = {
      def stepWith(accum: Seq[E]): Iteratee[E, Seq[E]] = {
        if (accum.length >= n) Done(accum) else Cont {
          case Input.EOF =>
            Done(accum, Input.EOF)
          case Input.Empty =>
            stepWith(accum)
          case Input.El(el) =>
            if(filter(accum, el))
              stepWith(accum :+ el)
            else
              stepWith(accum)
        }
      }
      stepWith(Seq.empty)
    }

    def uniqueIdFilter(l: Seq[OpenAssignment], next: OpenAssignment) =
      !l.map(_._task).contains(next._task)

    def findNextAssignments = {
      TaskService.findAssignable(user) |>>> takeUpTo[OpenAssignment](limit, uniqueIdFilter)
    }
    for {
      assignments <- findNextAssignments
    } yield {
      Ok(Json.toJson(assignments))
    }
  }
}
