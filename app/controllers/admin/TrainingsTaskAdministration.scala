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

object TrainingsTaskAdministration extends Controller with Secured {
  
  override val DefaultAccessRole = Role.User
  override val DefaultAccessPermission = Some(Permission("admin.review", List("access")))

  val trainingsTaskForm = Form(
    mapping(
      "task" -> text.verifying("task.notFound", task => Task.findOneById(task).isDefined),
      "training" -> mapping(
        "domain" -> nonEmptyText(1, 50),
        "gain" -> number,
        "loss" -> number)(Training.fromForm)(Training.toForm))(Task.fromTrainingForm)(Task.toTrainingForm)).fill(Task.withEmptyTraining)

  val trainingsTracingForm = Form(
    mapping(
      "tracing" -> text.verifying("tracing.notFound", exp => Tracing.findOneById(exp).isDefined),
      "taskType" -> text.verifying("taskType.notFound", task => TaskType.findOneById(task).isDefined),
      "experience" -> mapping(
        "domain" -> text,
        "value" -> number)(Experience.apply)(Experience.unapply),
      "priority" -> number,
      "training" -> mapping(
        "domain" -> nonEmptyText(1, 50),
        "gain" -> number,
        "loss" -> number)(Training.fromForm)(Training.toForm))(Task.fromTrainingsTracingForm)(Task.toTrainingsTracingForm)).fill(Task.withEmptyTraining)

  def list = Authenticated { implicit request =>
    Ok(html.admin.task.trainingsTaskList(Task.findAllTrainings))
  }

  def trainingsTaskCreateHTML(taskForm: Form[Task], tracingForm: Form[Task])(implicit request: AuthenticatedRequest[_]) = {
    html.admin.task.trainingsTaskCreate(
      Task.findAllNonTrainings,
      Tracing.findAllExploratory(request.user),
      TaskType.findAll,
      Experience.findAllDomains,
      taskForm,
      tracingForm)
  }

  def create(taskId: String) = Authenticated { implicit request =>
    val form = Task.findOneById(taskId) map { task =>
      trainingsTaskForm.fill(task)
    } getOrElse trainingsTaskForm
    Ok(trainingsTaskCreateHTML(trainingsTaskForm, trainingsTracingForm))
  }

  def createFromTracing = Authenticated(parser = parse.multipartFormData) { implicit request =>
    trainingsTracingForm.bindFromRequest.fold(
      formWithErrors => BadRequest(trainingsTaskCreateHTML(trainingsTaskForm, formWithErrors)),
      { task =>
        for {
          training <- task.training ?~ Messages("task.training.notFound")
          sample <- Tracing.findOneById(training.sample) ?~ Messages("trask.training.sample.notFound")
        } yield {
          sample.update(_.copy(tracingType = TracingType.Sample))
          Task.insertOne(task)
          Ok(html.admin.task.trainingsTaskList(Task.findAllTrainings))
        }
      })
  }

  def createFromForm = Authenticated(parser = parse.multipartFormData) { implicit request =>
    trainingsTaskForm.bindFromRequest.fold(
      formWithErrors => BadRequest(trainingsTaskCreateHTML(formWithErrors, trainingsTracingForm)),
      { task =>
        implicit val ctx = NMLContext(request.user)
        for {
          nmlFile <- request.body.file("nmlFile")  ?~ Messages("nml.file.notFound")
          tracing <- new NMLParser(nmlFile.ref.file).parse.headOption ?~ Messages("nml.file.invalid")
        } yield {
          Tracing.save(tracing.copy(tracingType = TracingType.Sample))
          Task.save(task.copy(
            training = task.training.map(_.copy(sample = tracing._id))))
          Ok(html.admin.task.trainingsTaskList(Task.findAllTrainings))
        }
      })
  }

  def delete(taskId: String) = Authenticated { implicit request =>
    for{
      task <- Task.findOneById(taskId) ?~ Messages("task.training.notFound")
    } yield {
      Task.remove(task)
      JsonOk(Messages("task.training.deleted"))
    }
  }
}