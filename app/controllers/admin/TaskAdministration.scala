package controllers.admin

import scala.Array.canBuildFrom
import scala.Option.option2Iterable

import brainflight.security.AuthenticatedRequest
import brainflight.security.Secured
import brainflight.tools.ExtendedTypes.String2ExtendedString
import brainflight.tools.geometry.Point3D
import models.binary.DataSet
import models.security.Role
import models.task.Experiment
import models.task.Task
import models.task.TaskType
import play.api.data.Form
import play.api.data.Forms.mapping
import play.api.data.Forms.number
import play.api.data.Forms.text
import play.api.mvc.Controller
import views.html

object TaskAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  val taskFromExperimentForm = Form(
    mapping(
      "experiment" -> text.verifying("experiment.invalid", experiment => Experiment.findOneById(experiment).isDefined),
      "taskType" -> text.verifying("taskType.invalid", task => TaskType.findOneById(task).isDefined),
      "priority" -> number,
      "taskInstances" -> number)(Task.fromExperimentForm)(Task.toExperimentForm)).fill(Task.empty)

  val taskForm = Form(
    mapping(
      "dataSet" -> text.verifying("dataSet.invalid", name => DataSet.findOneByName(name).isDefined),
      "taskType" -> text.verifying("taskType.invalid", task => TaskType.findOneById(task).isDefined),
      "cellId" -> number,
      "start" -> mapping(
        "point" -> text.verifying("point.invalid", p => p.matches("([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*")))(Point3D.fromForm)(Point3D.toForm),
      "priority" -> number,
      "taskInstances" -> number)(Task.fromForm)(Task.toForm)).fill(Task.empty)

  def list = Authenticated { implicit request =>
    Ok(html.admin.task.taskList(request.user, Task.findAll))
  }
  
  def taskCreateHTML(experimentForm: Form[models.task.Task], taskForm: Form[models.task.Task])(implicit request: AuthenticatedRequest[_]) = 
    html.admin.task.taskCreate(request.user, Experiment.findAllExploratory, TaskType.findAll, DataSet.findAll, experimentForm, taskForm)

  def create = Authenticated { implicit request =>
    Ok(taskCreateHTML(taskForm, taskFromExperimentForm))
  }

  def createFromForm = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    taskForm.bindFromRequest.fold(
      formWithErrors => BadRequest(taskCreateHTML(taskFromExperimentForm,formWithErrors)),
      { t =>
        Task.insert(t)
        Ok(t.toString)
      })
  }

  def createFromExperiment = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    taskFromExperimentForm.bindFromRequest.fold(
      formWithErrors => BadRequest(taskCreateHTML(formWithErrors, taskForm)),
      { t =>
        Task.insert(t)
        Redirect(routes.TaskAdministration.list)
      })
  }

  def createBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    request.request.body.get("data").flatMap(_.headOption).map { data =>
      val inserted = data
        .split("\n")
        .map(_.split(" "))
        .filter(_.size == 8)
        .flatMap { params =>
          for {
            cellId <- params(1).toIntOpt
            taskTypeSummary = params(2)
            taskType <- TaskType.findOneBySumnary(taskTypeSummary)
            x <- params(3).toIntOpt
            y <- params(4).toIntOpt
            z <- params(5).toIntOpt
            priority <- params(6).toIntOpt
            instances <- params(7).toIntOpt
          } yield {
            val dataSetName = params(0)
            Task(dataSetName, cellId, 0, taskType._id, Point3D(x, y, z), priority, instances)
          }
        }
        .flatMap { t =>
          println("Created task: " + t)
          Task.insert(t)
        }
      Ok("Inserted: " + inserted.mkString(" "))
    } getOrElse BadRequest("'data' parameter is mising")
  }
}