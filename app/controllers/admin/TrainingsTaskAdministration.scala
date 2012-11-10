package controllers.admin

import controllers.Controller
import play.mvc.Security.Authenticated
import brainflight.security.Secured
import models.security.Role
import views._
import play.api.data.Form
import play.api.data.Forms._
import brainflight.security.AuthenticatedRequest
import models.task.TaskType
import models.binary.DataSet
import models.task.Task
import models.user.Experience
import models.task.Training
import models.task.Experiment

object TrainingsTaskAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  val trainingsTaskForm = Form(
    mapping(
      "task" -> text.verifying("task.invalid", task => Task.findOneById(task).isDefined),
      "training" -> mapping(
          "domain" -> nonEmptyText(1, 50),
          "gain" -> number,
          "loss" -> number)(Training.apply)(Training.unapply))
          (Task.fromTrainingForm)(Task.toTrainingForm))

  def list = Authenticated { implicit request =>
    Ok(html.admin.task.trainingsTaskList(request.user, Task.findAllTrainings))
  }

  def trainingsTaskCreateHTML(form: Form[Task])(implicit request: AuthenticatedRequest[_]) = {
    html.admin.task.trainingsTaskCreate(request.user, 
        Task.findAllNonTrainings, 
        Experience.findAllDomains, 
        form)
  }
  def create(taskId: String) = Authenticated { implicit request =>
    val form = Task.findOneById(taskId) map{ task =>
      trainingsTaskForm.fill(task)
    } getOrElse trainingsTaskForm
    Ok(trainingsTaskCreateHTML(form))
  }

  def createFromForm = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    trainingsTaskForm.bindFromRequest.fold(
      formWithErrors => BadRequest(trainingsTaskCreateHTML(formWithErrors)),
      { t =>
        Task.save(t)
        Ok(html.admin.task.trainingsTaskList(request.user, Task.findAllTrainings))
      })
  }

  def delete(taskId: String) = Authenticated { implicit request =>
    Task.findOneById(taskId) map { task =>
      Task.remove(task)
      AjaxOk.success("Trainings-Task successfuly deleted.")
    } getOrElse AjaxBadRequest.error("Trainings-Task not found.")
  }
}