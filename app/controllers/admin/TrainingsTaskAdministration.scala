package controllers.admin

import controllers.Controller
import play.mvc.Security.Authenticated
import brainflight.security.Secured
import models.security.Role
import models.task.TrainingsTask
import views._
import play.api.data.Form
import play.api.data.Forms._
import brainflight.security.AuthenticatedRequest
import models.task.TaskType
import models.binary.DataSet
import models.task.Task
import models.task.TrainingsExperiment
import models.user.Experience

object TrainingsTaskAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  val trainingsTaskForm = Form(
    mapping(
      "task" -> text.verifying("task.invalid", task => Task.findOneById(task).isDefined),
      "experience" -> text,
      "gain" -> number,
      "lose" -> number)(TrainingsTask.fromForm)(TrainingsTask.toForm))

  def list = Authenticated { implicit request =>
    Ok(html.admin.task.trainingsTaskList(request.user, TrainingsTask.findAll))
  }

  def trainingsTaskCreateHTML(form: Form[TrainingsTask])(implicit request: AuthenticatedRequest[_]) = {
    html.admin.task.trainingsTaskCreate(request.user, Task.findAll, Experience.findAll, form)
  }
  def create(taskId: String) = Authenticated { implicit request =>
    val form = Task.findOneById(taskId) map{ task =>
      trainingsTaskForm.fill(TrainingsTask(task, "", 10, 5))
    } getOrElse trainingsTaskForm
    Ok(trainingsTaskCreateHTML(form))
  }

  def createFromForm = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    trainingsTaskForm.bindFromRequest.fold(
      formWithErrors => BadRequest(trainingsTaskCreateHTML(formWithErrors)),
      { t =>
        TrainingsTask.insert(t)
        Ok(html.admin.task.trainingsTaskList(request.user, TrainingsTask.findAll))
      })
  }

  def delete(trainingsTaskId: String) = Authenticated { implicit request =>
    TrainingsTask.findOneById(trainingsTaskId) map { trainingsTask =>
      TrainingsTask.remove(trainingsTask)
      AjaxOk.success("Trainings-Task successfuly deleted.")
    } getOrElse AjaxBadRequest.error("Trainings-Task not found.")
  }
  
  def review(trainingsExperimentId: String) = Authenticated { implicit request =>
    TrainingsExperiment.findOneById(trainingsExperimentId) map { trainingsExperiment =>
      TrainingsExperiment.assignReviewee(trainingsExperiment, request.user)
      AjaxOk.success("Trainings-Task successfuly deleted.")
    } getOrElse BadRequest("Trainings-Experiment not found.")
  }
}