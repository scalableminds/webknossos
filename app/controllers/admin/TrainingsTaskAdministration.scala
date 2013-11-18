package controllers.admin

import play.mvc.Security.Authenticated
import oxalis.security.Secured
import models.security._
import play.api.data.Form
import play.api.data.Forms._
import oxalis.security.AuthenticatedRequest
import models.task.TaskType
import braingames.binary.models.DataSet
import models.task.Task
import models.user.Experience
import models.task.Training
import oxalis.nml._
import play.api.i18n.Messages
import models.task.Project
import java.util.Date
import models.annotation.{AnnotationService, AnnotationType, AnnotationDAO}
import models.tracing.skeleton.SkeletonTracing
import views._
import controllers.Controller
import play.api.libs.concurrent.Execution.Implicits._

object TrainingsTaskAdministration extends AdminController {

  override val DefaultAccessPermission = Some(Permission("admin.review", List("access")))

  val trainingsTaskForm = Form(
    tuple(
      "task" -> text.verifying("task.notFound", task => Task.findOneById(task).isDefined),
      "tracing" -> text.verifying("tracing.notFound", exp => SkeletonTracing.findOneById(exp).isDefined),
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
      AnnotationService.openExplorationalFor(request.user),
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
    formWithErrors => BadRequest(trainingsTaskCreateHTML(formWithErrors)), {
      case (taskId, annotationId, training) =>
        Async {
          for {
            task <- Task.findOneById(taskId) ?~> Messages("task.notFound")
            annotation <- AnnotationDAO.findOneById(annotationId) ?~> Messages("annotation.notFound")
            trainingsTask = Task.copyDeepAndInsert(task.copy(
              instances = Integer.MAX_VALUE,
              created = new Date),
              includeUserTracings = false)
            _ <- AnnotationDAO.createSample(annotation, trainingsTask._id).map { sample =>
              trainingsTask.update(_.copy(training = Some(training.copy(sample = sample._id))))
            }
          } yield {
            Ok(html.admin.training.trainingsTaskList(Task.findAllTrainings))
          }
        }
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