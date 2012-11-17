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
import models.experiment.Experiment
import nml._
import models.experiment.ExperimentType

object TrainingsTaskAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  val trainingsTaskForm = Form(
    mapping(
      "task" -> text.verifying("task.invalid", task => Task.findOneById(task).isDefined),
      "training" -> mapping(
        "domain" -> nonEmptyText(1, 50),
        "gain" -> number,
        "loss" -> number)(Training.fromForm)(Training.toForm))(Task.fromTrainingForm)(Task.toTrainingForm)).fill(Task.withEmptyTraining)

  val trainingsExperimentForm = Form(
    mapping(
      "experiment" -> text.verifying("experiment.invalid", exp => Experiment.findOneById(exp).isDefined),
      "taskType" -> text.verifying("taskType.invalid", task => TaskType.findOneById(task).isDefined),
      "experience" -> mapping(
        "domain" -> text,
        "value" -> number)(Experience.apply)(Experience.unapply),
      "priority" -> number,
      "training" -> mapping(
        "domain" -> nonEmptyText(1, 50),
        "gain" -> number,
        "loss" -> number)(Training.fromForm)(Training.toForm))(Task.fromTrainingsExperimentForm)(Task.toTrainingsExperimentForm))

  def list = Authenticated { implicit request =>
    Ok(html.admin.task.trainingsTaskList(request.user, Task.findAllTrainings))
  }

  def trainingsTaskCreateHTML(taskForm: Form[Task], experimentForm: Form[Task])(implicit request: AuthenticatedRequest[_]) = {
    html.admin.task.trainingsTaskCreate(request.user,
      Task.findAllNonTrainings,
      Experiment.findAllExploratory(request.user),
      TaskType.findAll,
      Experience.findAllDomains,
      taskForm,
      experimentForm)
  }

  def create(taskId: String) = Authenticated { implicit request =>
    val form = Task.findOneById(taskId) map { task =>
      trainingsTaskForm.fill(task)
    } getOrElse trainingsTaskForm
    Ok(trainingsTaskCreateHTML(trainingsTaskForm, trainingsExperimentForm))
  }

  def createFromExperiment = Authenticated(parser = parse.multipartFormData) { implicit request =>
    trainingsExperimentForm.bindFromRequest.fold(
      formWithErrors => BadRequest(trainingsTaskCreateHTML(trainingsTaskForm, formWithErrors)),
      { task =>
        (for {
          training <- task.training
          sample <- Experiment.findOneById(training.sample)
        } yield {
          Experiment.save(sample.copy(experimentType = ExperimentType.Sample))
          Task.save(task)
          Ok(html.admin.task.trainingsTaskList(request.user, Task.findAllTrainings))
        }) getOrElse BadRequest("Couldn't create Training.")
      })
  }

  def createFromForm = Authenticated(parser = parse.multipartFormData) { implicit request =>
    trainingsTaskForm.bindFromRequest.fold(
      formWithErrors => BadRequest(trainingsTaskCreateHTML(formWithErrors, trainingsExperimentForm)),
      { task =>
        implicit val ctx = NMLContext(request.user)
        (for {
          nmlFile <- request.body.file("nmlFile")
          experiment <- new NMLParser(nmlFile.ref.file).parse.headOption
        } yield {
          Experiment.save(experiment.copy(experimentType = ExperimentType.Sample))
          Task.save(task.copy(
            training = task.training.map(_.copy(sample = experiment._id))))
          Ok(html.admin.task.trainingsTaskList(request.user, Task.findAllTrainings))
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