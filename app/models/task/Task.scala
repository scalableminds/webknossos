package models.task

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics._
import java.util.Date
import brainflight.tools.geometry.Point3D
import play.api.libs.concurrent.Akka
import play.api.Play.current
import akka.actor.Props
import akka.pattern.ask
import brainflight.js.JsExecutionActor
import brainflight.js.JS
import akka.util.Timeout
import scala.concurrent.duration._
import akka.pattern.AskTimeoutException
import org.bson.types.ObjectId
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Promise
import play.api.libs.json.Format
import play.api.libs.json.Json
import play.api.libs.json.Writes
import brainflight.tools.geometry.Scale
import models.user.User
import play.api.Logger
import models.user.Experience
import models.tracing._
import nml.Tree

case class CompletionStatus(open: Int, inProgress: Int, completed: Int)

case class Task(
    seedIdHeidelberg: Int,
    _taskType: ObjectId,
    neededExperience: Experience = Experience.empty,
    priority: Int = 100,
    instances: Int = 1,
    assignedInstances: Int = 0,
    created: Date = new Date,
    _project: Option[String] = None,
    training: Option[Training] = None,
    _id: ObjectId = new ObjectId) extends DAOCaseClass[Task] {

  val dao = Task

  lazy val id = _id.toString

  def taskType = TaskType.findOneById(_taskType)

  def project = _project.flatMap(name => Project.findOneByName(name))

  def tracings =
    Tracing.findByTaskIdAndType(_id, TracingType.Task)

  def isFullyAssigned = instances <= assignedInstances

  def isTraining = training.isDefined

  def tracingBase = Tracing.findByTaskIdAndType(_id, TracingType.TracingBase).headOption

  def assigneOnce = this.copy(assignedInstances = assignedInstances + 1)

  def status = {
    val inProgress = tracings.filter(!_.state.isFinished).size
    CompletionStatus(
      open = instances - assignedInstances,
      inProgress = inProgress,
      completed = assignedInstances - inProgress)
  }
}

object Task extends BasicDAO[Task]("tasks") {
  val jsExecutionActor = Akka.system.actorOf(Props[JsExecutionActor])
  val conf = current.configuration

  //val withEmptyTraining = empty.copy(training = Some(Training.empty))

  implicit val timeout = Timeout((conf.getInt("js.defaultTimeout") getOrElse 5) seconds) // needed for `?` below

  override def remove(t: Task) = {
    Tracing.removeAllWithTaskId(t._id)
    super.remove(t)
  }

  def isTrainingsTracing(tracing: Tracing) = {
    tracing.task.map(_.isTraining) getOrElse false
  }

  def findAllOfOneType(isTraining: Boolean) =
    find(MongoDBObject("training" -> MongoDBObject("$exists" -> isTraining)))
      .toList

  def findAllByProject(project: String) =
    find(MongoDBObject("_project" -> project))
      .toList

  def findAllTrainings =
    findAllOfOneType(isTraining = true)

  def findAllNonTrainings =
    findAllOfOneType(isTraining = false)

  def findAllAssignableNonTrainings =
    findAllNonTrainings.filter(!_.isFullyAssigned)

  def createAndInsertDeepCopy(source: Task, includeUserTracings: Boolean = true) = {
    val task = insertOne(source.copy(_id = new ObjectId))
    Tracing
      .findByTaskId(source._id)
      .foreach { tracing =>
        if (includeUserTracings || TracingType.isSystemTracing(tracing))
          Tracing.createAndInsertDeepCopy(tracing.copy(_task = Some(task._id)))
      }
    task
  }

  def toTrainingForm(t: Task): Option[(String, Training)] =
    Some((t.id, (t.training getOrElse Training.empty)))

  def fromTrainingForm(taskId: String, training: Training) =
    Task.findOneById(taskId) map {
      _.copy(training = Some(training))
    } getOrElse null

  def hasEnoughExperience(user: User)(task: Task) = {
    val XP = user.experiences.get(task.neededExperience.domain) getOrElse 0
    XP >= task.neededExperience.value
  }

  def nextTaskForUser(user: User): Future[Option[Task]] = {
    nextTaskForUser(
      user,
      findAllAssignableNonTrainings.filter(hasEnoughExperience(user)).toArray)
  }

  private def nextTaskForUser(user: User, tasks: Array[Task]): Future[Option[Task]] = {
    if (tasks.isEmpty) {
      Future.successful(None)
    } else {
      val params = Map("user" -> user, "tasks" -> tasks)

      val future = (jsExecutionActor ? JS(TaskSelectionAlgorithm.current.js, params)) recover {
        case e: AskTimeoutException =>
          Logger.warn("JS Execution actor didn't return in time!")
          null
      }
      future.mapTo[Future[Task]].flatMap(_.map { x =>
        Option(x)
      }).recover {
        case e: Exception =>
          Logger.error("Catched MAPTO exception: ")
          e.printStackTrace()
          None
      }
    }
  }

  def simulateFinishOfCurrentTask(user: User) = {
    (for {
      tracing <- Tracing.findOpenTracingFor(user, TracingType.Task)
      task <- tracing.task
      if (task.isTraining)
      training <- task.training
    } yield {
      user.increaseExperience(training.domain, training.gain)
    }) getOrElse user
  }

  def simulateTaskAssignment(users: List[User]) = {
    val preparedUsers = users.map(simulateFinishOfCurrentTask)
    def f(users: List[User], tasks: Map[ObjectId, Task], result: Map[User, Task]): Future[Map[User, Task]] = {
      users match {
        case user :: tail =>
          simulateTaskAssignments(user, tasks).flatMap {
            case Some((task, alertedtasks)) =>
              f(tail, alertedtasks, result + (user -> task))
            case _ =>
              f(tail, tasks, result)
          }
        case _ =>
          Future.successful(result)
      }
    }
    val nonTrainings = findAllAssignableNonTrainings.map(t => t._id -> t).toMap
    f(preparedUsers, nonTrainings, Map.empty)
  }

  def simulateTaskAssignments(user: User, tasks: Map[ObjectId, Task]) = {
    val openTask = Tracing.findOpenTracingFor(user, TracingType.Task).flatMap(_.task).map(_._id) getOrElse null
    val tasksAvailable = tasks.values.filter(t =>
      hasEnoughExperience(user)(t) && openTask != t._id && !t.isFullyAssigned)
    nextTaskForUser(user, tasksAvailable.toArray).map {
      case Some(task) =>
        Some(task -> (tasks + (task._id -> task.copy(assignedInstances = task.assignedInstances + 1))))
      case _ =>
        Training.findAllFor(user).headOption.map { task =>
          task -> tasks
        }
    }
  }

  /*implicit object TaskFormat extends Writes[Task] {
    val TASK_ID = "taskId"
    val CELL_ID = "cellId"
    val START = "start"
    val PRIORITY = "priority"
    val CREATED = "created"

    def writes(e: Task) = Json.obj(
      TASK_ID -> e.id,
      START -> e.start,
      PRIORITY -> e.priority)
  }*/
}