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

case class Task(
    dataSetName: String,
    seedIdHeidelberg: Int,
    _taskType: ObjectId,
    start: Point3D,
    neededExperience: Experience = Experience.empty,
    priority: Int = 100,
    instances: Int = 1,
    created: Date = new Date,
    _tracings: List[ObjectId] = Nil,
    training: Option[Training] = None,
    _id: ObjectId = new ObjectId) extends DAOCaseClass[Task] {

  val dao = Task

  lazy val id = _id.toString

  def taskType = TaskType.findOneById(_taskType)

  def tracings = _tracings.map(Tracing.findOneById).flatten

  def isFullyAssigned = _tracings.size == instances

  def isTraining = training.isDefined

  def inProgress =
    tracings.filter(!_.state.isFinished).size

  def completed =
    tracings.size - inProgress

  def open =
    instances - tracings.size

  def removeTracing(tracing: Tracing) = {
    this.copy(
      _tracings = this._tracings.filterNot(_ == tracing._id))
  }

  def addTracing(tracing: Tracing) = {
    this.copy(
      _tracings = tracing._id :: this._tracings)
  }

}

object Task extends BasicDAO[Task]("tasks") {
  val jsExecutionActor = Akka.system.actorOf(Props[JsExecutionActor])
  val conf = current.configuration

  val empty = Task("", 0, null, Point3D(0, 0, 0))

  val withEmptyTraining = empty.copy(training = Some(Training.empty))

  implicit val timeout = Timeout((conf.getInt("js.defaultTimeout") getOrElse 5) seconds) // needed for `?` below

  override def remove(t: Task) = {
    t.tracings.map { tracing =>
      tracing.update(_.removeTask)
    }
    super.remove(t)
  }

  def findAllOfOneType(isTraining: Boolean) =
    find(MongoDBObject("training" -> MongoDBObject("$exists" -> isTraining)))
      .toList

  def findAllTrainings =
    findAllOfOneType(isTraining = true)

  def findAllNonTrainings =
    findAllOfOneType(isTraining = false)

  def findAllAssignableNonTrainings =
    findAllNonTrainings.filter(!_.isFullyAssigned)

  def toTracingForm(t: Task): Option[(String, String, Experience, Int, Int)] = {
    Some(("",
      t.taskType.map(_.id).getOrElse(""),
      t.neededExperience,
      t.priority,
      t.instances))
  }

  def toTrainingForm(t: Task): Option[(String, Training)] =
    Some(t.id -> (t.training getOrElse Training.empty))

  def fromTrainingForm(taskId: String, training: Training) =
    Task.findOneById(taskId) map {
      _.copy(training = Some(training))
    } getOrElse null

  def fromTrainingsTracingForm(tracingId: String, taskTypeId: String, experience: Experience, priority: Int, training: Training) =
    (for {
      e <- Tracing.findOneById(tracingId)
      taskType <- TaskType.findOneById(taskTypeId)
    } yield {
      Task(e.dataSetName,
        0,
        taskType._id,
        e.editPosition,
        experience,
        priority,
        Integer.MAX_VALUE,
        training = Some(training.copy(sample = e._id)))
    }) getOrElse null

  def toTrainingsTracingForm(t: Task) = {
    Some(("",
      t.taskType.map(_.id).getOrElse(""),
      t.neededExperience,
      t.priority,
      t.training getOrElse null))
  }

  def fromTracingForm(tracing: String, taskTypeId: String, experience: Experience, priority: Int, instances: Int): Task =
    (Tracing.findOneById(tracing), TaskType.findOneById(taskTypeId)) match {
      case (Some(e), Some(taskType)) =>
        Task(e.dataSetName,
          0,
          taskType._id,
          e.editPosition,
          experience,
          priority,
          instances)
      case _ =>
        Logger.warn(s"Failed to create Task from form. Tracing: $tracing TaskType: $taskTypeId")
        null
    }

  def fromForm(dataSetName: String, taskTypeId: String, start: Point3D, experience: Experience, priority: Int, instances: Int): Task =
    TaskType.findOneById(taskTypeId) match {
      case Some(taskType) =>
        Task(dataSetName,
          0,
          taskType._id,
          start,
          experience,
          priority,
          instances)
      case _ =>
        Logger.warn(s"Failed to create Task from form. TaskType: $taskTypeId")
        null
    }

  def toForm(t: Task): Option[(String, String, Point3D, Experience, Int, Int)] = {
    Some((
      t.dataSetName,
      t.taskType.map(_.id).getOrElse(""),
      t.start,
      t.neededExperience,
      t.priority,
      t.instances))
  }

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
    (for{
      tracing <- Tracing.findOpenTrainingFor(user)
      if(tracing.isTrainingsTracing)
      task <- tracing.task
      training <- task.training
    } yield {
      user.increaseExperience(training.domain, training.gain)
    }) getOrElse user
  }

  def simulateTaskAssignment(users: List[User]) = {
    val preparedUsers = users.map( simulateFinishOfCurrentTask )
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
    val openTask = Tracing.findOpenTracingFor(user, false).flatMap(_.task).map(_._id) getOrElse null
    val tasksAvailable = tasks.values.filter( t =>
        hasEnoughExperience(user)(t) && openTask != t._id && !t.isFullyAssigned)
    nextTaskForUser(user, tasksAvailable.toArray).map {
      case Some(task) =>
        Some(task -> (tasks + (task._id -> task.copy(_tracings = new ObjectId :: task._tracings))))
      case _ =>
        Training.findAllFor(user).headOption.map { task =>
          task -> tasks
        }
    }
  }

  implicit object TaskFormat extends Writes[Task] {
    val TASK_ID = "taskId"
    val CELL_ID = "cellId"
    val START = "start"
    val PRIORITY = "priority"
    val CREATED = "created"

    def writes(e: Task) = Json.obj(
      TASK_ID -> e.id,
      START -> e.start,
      PRIORITY -> e.priority)
  }
}