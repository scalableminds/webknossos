package controllers.admin

import braingames.mvc.Controller
import play.mvc.Security.Authenticated
import oxalis.security.Secured
import models.security._
import views._
import play.api.data.Form
import play.api.data.Forms._
import oxalis.security.AuthenticatedRequest
import models.task.TaskType
import braingames.binary.models.DataSet
import models.task.Task
import models.user.Experience
import models.task.Training
import models.tracing.Tracing
import oxalis.nml._
import play.api.i18n.Messages
import models.task.Project
import java.util.Date
import models.annotation.{AnnotationType, AnnotationDAO}

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
    .fill("", "", Training.empty)

  def taskToForm(t: Task) = {
    (t.id, "", Training.empty)
  }
  def list = Authenticated { implicit request =>
    Ok(html.admin.training.trainingsTaskList(Task.findAllTrainings))
  }

  def trainingsTaskCreateHTML(taskForm: Form[(String, String, Training)])(implicit request: AuthenticatedRequest[_]) = {
    html.admin.training.trainingsTaskCreate(
      Task.findAllNonTrainings,
      AnnotationDAO.findOpenAnnotationsFor(request.user, AnnotationType.Explorational),
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
      {
        case (taskId, annotationId, training) =>
          (for {
            task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
            annotation <- AnnotationDAO.findOneById(annotationId) ?~ Messages("annotation.notFound")
          } yield {
            val trainingsTask = Task.copyDeepAndInsert(task.copy(
              instances = Integer.MAX_VALUE,
              created = new Date),
              includeUserTracings = false)

            val sample = AnnotationDAO.createSample(annotation, trainingsTask._id)
            trainingsTask.update(_.copy(training = Some(training.copy(sample = sample._id))))

            Ok(html.admin.training.trainingsTaskList(Task.findAllTrainings))
          })
      })
  }

  def delete(taskId: String) = Authenticated { implicit request =>
    for {
      task <- Task.findOneById(taskId) ?~ Messages("task.training.notFound")
    } yield {
      Task.removeById(task._id)
      JsonOk(Messages("task.training.deleted"))
    }
  }
}