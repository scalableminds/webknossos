package models.task

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import java.util.Date
import brainflight.tools.geometry.Point3D
import play.api.libs.concurrent.Akka
import play.api.Play.current
import akka.actor.Props
import akka.pattern.ask
import brainflight.js.JsExecutionActor
import brainflight.js.JS
import akka.util.Timeout
import akka.util.duration._
import akka.pattern.AskTimeoutException
import org.bson.types.ObjectId
import akka.dispatch.Future
import play.api.libs.concurrent.execution.defaultContext
import akka.dispatch.Promise
import play.api.libs.json.Format
import play.api.libs.json.Json
import play.api.libs.json.Writes
import models.graph.Tree
import brainflight.tools.geometry.Scale
import models.user.User
import play.api.Logger
import models.user.Experience

case class Task(
    dataSetName: String,
    seedIdHeidelberg: Int,
    _taskType: ObjectId,
    start: Point3D,
    neededExperience: Experience = Experience.empty,
    priority: Int = 100,
    instances: Int = 1,
    created: Date = new Date,
    _experiments: List[ObjectId] = Nil,
    training: Option[Training] = None,
    _id: ObjectId = new ObjectId) {

  lazy val id = _id.toString

  def taskType = TaskType.findOneById(_taskType)

  def experiments = _experiments.map(Experiment.findOneById).flatten

  def isFullyAssigned = experiments.size == instances

  def isTraining = training.isDefined

  def inProgress =
    experiments.filter(!_.state.isFinished).size

  def completed =
    experiments.size - inProgress

  def open =
    instances - experiments.size
}

object Task extends BasicDAO[Task]("tasks") {
  val jsExecutionActor = Akka.system.actorOf(Props[JsExecutionActor])
  val conf = current.configuration

  val empty = Task("", 0, null, Point3D(0, 0, 0))
  
  val withEmptyTraining = empty.copy(training = Some(Training.empty))

  implicit val timeout = Timeout((conf.getInt("js.defaultTimeout") getOrElse 5) seconds) // needed for `?` below
  
  override def remove(t: Task) = {
    t.experiments.map{ experiment =>
      Experiment.removeTask(experiment)
    }
    super.remove(t)
  }
  
  def removeExperiment(task: Task, experiment: Experiment){
    alterAndSave(task.copy(
        _experiments = task._experiments.filterNot( _ == experiment._id)))
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

  def addExperiment(task: Task, experiment: Experiment) = {
    alterAndSave(task.copy(
      _experiments = experiment._id :: task._experiments))
  }

  def toExperimentForm(t: Task): Option[(String, String, Experience, Int, Int)] = {
    Some(("",
      "",
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

  def fromExperimentForm(experiment: String, taskTypeId: String, experience: Experience, priority: Int, instances: Int): Task =
    (Experiment.findOneById(experiment), TaskType.findOneById(taskTypeId)) match {
      case (Some(e), Some(taskType)) =>
        Task(e.dataSetName,
          0,
          taskType._id,
          e.editPosition,
          experience,
          priority,
          instances)
      case _ =>
        Logger.warn("Failed to create Task from form. Experiment: %s TaskType: %s".format(experiment, taskTypeId))
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
        Logger.warn("Failed to create Task from form. TaskType: %s".format(taskTypeId))
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
    val tasks = findAllAssignableNonTrainings.filter(hasEnoughExperience(user)).toArray
    if (tasks.isEmpty) {
      Promise.successful(None)(Akka.system.dispatcher)
    } else {
      val params = Map("user" -> user, "tasks" -> tasks)

      val future = (jsExecutionActor ? JS(TaskSelectionAlgorithm.current.js, params)) recover {
        case e: AskTimeoutException =>
          Logger.warn("JS Execution actor didn't return in time!")
          null
      }
      future.mapTo[Promise[Task]].flatMap(_.map { x =>
        Option(x)
      }).recover {
        case e: Exception =>
          Logger.error("Catched MAPTO exception: ")
          e.printStackTrace()
          None
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