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
import models.tracing.Tracing
import nml._
import models.tracing.TracingType

object TrainingsTaskAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  val trainingsTaskForm = Form(
    mapping(
      "task" -> text.verifying("task.invalid", task => Task.findOneById(task).isDefined),
      "training" -> mapping(
        "domain" -> nonEmptyText(1, 50),
        "gain" -> number,
        "loss" -> number)(Training.fromForm)(Training.toForm))(Task.fromTrainingForm)(Task.toTrainingForm)).fill(Task.withEmptyTraining)

  val trainingsTracingForm = Form(
    mapping(
      "tracing" -> text.verifying("tracing.invalid", exp => Tracing.findOneById(exp).isDefined),
      "taskType" -> text.verifying("taskType.invalid", task => TaskType.findOneById(task).isDefined),
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
        (for {
          training <- task.training
          sample <- Tracing.findOneById(training.sample)
        } yield {
          Tracing.save(sample.copy(tracingType = TracingType.Sample))
          Task.save(task)
          Ok(html.admin.task.trainingsTaskList(Task.findAllTrainings))
        }) getOrElse BadRequest("Couldn't create Training.")
      })
  }

  def createFromForm = Authenticated(parser = parse.multipartFormData) { implicit request =>
    trainingsTaskForm.bindFromRequest.fold(
      formWithErrors => BadRequest(trainingsTaskCreateHTML(formWithErrors, trainingsTracingForm)),
      { task =>
        implicit val ctx = NMLContext(request.user)
        (for {
          nmlFile <- request.body.file("nmlFile")
          tracing <- new NMLParser(nmlFile.ref.file).parse.headOption
        } yield {
          Tracing.save(tracing.copy(tracingType = TracingType.Sample))
          Task.save(task.copy(
            training = task.training.map(_.copy(sample = tracing._id))))
          Ok(html.admin.task.trainingsTaskList(Task.findAllTrainings))
        }) getOrElse BadRequest("No valid file attached.")
      })
  }

  def delete(taskId: String) = Authenticated { implicit request =>
    Task.findOneById(taskId) map { task =>
      Task.remove(task)
      AjaxOk.success("Trainings-Task successfuly deleted.")
    } getOrElse AjaxBadRequest.error("Trainings-Task not found.")
  }
}