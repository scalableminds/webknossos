package controllers.admin

import braingames.mvc.Controller
import play.mvc.Security.Authenticated
import brainflight.security.Secured
import models.security._
import views._
import play.api.data.Form
import play.api.data.Forms._
import brainflight.security.AuthenticatedRequest
import models.task.TaskType
import models.binary.DataSet
import models.task.Task
import models.user.Experience
import models.task.Training
import models.tracing.Tracing
import nml._
import models.tracing.TracingType
import play.api.i18n.Messages
import models.task.Project
import java.util.Date

object TrainingsTaskAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.User
  override val DefaultAccessPermission = Some(Permission("admin.review", List("access")))

  val trainingsTaskForm = Form(
    tuple(
      "task" -> text.verifying("task.notFound", task => Task.findOneById(task).isDefined),
      "tracing" -> text.verifying("tracing.notFound", exp => Tracing.findOneById(exp).isDefined),
      "training" -> mapping(
        "domain" -> nonEmptyText(1, 50),
        "gain" -> number,
        "loss" -> number)(Training.fromForm)(Training.toForm)))

  def taskToForm(t: Task) = {
    (t.id, "", Training.empty)
  }        
  def list = Authenticated { implicit request =>
    Ok(html.admin.task.trainingsTaskList(Task.findAllTrainings))
  }

  def trainingsTaskCreateHTML(taskForm: Form[(String, String, Training)])(implicit request: AuthenticatedRequest[_]) = {
    html.admin.task.trainingsTaskCreate(
      Task.findAllNonTrainings,
      Tracing.findOpenTracingsFor(request.user, TracingType.Explorational),
      Experience.findAllDomains,
      taskForm)
  }

  def create(taskId: String) = Authenticated { implicit request =>
    val form = Task.findOneById(taskId) map { task =>
      trainingsTaskForm.fill(taskToForm(task))
    } getOrElse trainingsTaskForm
    Ok(trainingsTaskCreateHTML(trainingsTaskForm))
  }

  def createFromForm = Authenticated(parser = parse.multipartFormData) { implicit request =>
    trainingsTaskForm.bindFromRequest.fold(
      formWithErrors => BadRequest(trainingsTaskCreateHTML(formWithErrors)),
      { case (taskId, tracingId, training) =>
        (for {
          task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
          tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
        } yield {
          val sample = Tracing.createSample(task._id, tracing)
          Task.createAndInsertDeepCopy(task.copy(
              instances = Integer.MAX_VALUE,
              created = new Date,
              training = Some(training.copy(sample = sample._id))),
              includeUserTracings = false)
          Ok(html.admin.task.trainingsTaskList(Task.findAllTrainings))
        }) 
      })
  }

  def delete(taskId: String) = Authenticated { implicit request =>
    for {
      task <- Task.findOneById(taskId) ?~ Messages("task.training.notFound")
    } yield {
      Task.remove(task)
      JsonOk(Messages("task.training.deleted"))
    }
  }
}