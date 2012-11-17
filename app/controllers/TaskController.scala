package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import brainflight.security.Secured
import models.security.Role
import models.binary.DataSet
import play.api.Logger
import models.experiment.Experiment
import models.user._
import models.task._
import models.experiment.UsedExperiments
import views._
import play.api.libs.concurrent._
import play.api.libs.concurrent.execution.defaultContext
import play.api.i18n.Messages

object TaskController extends Controller with Secured {
  def request = Authenticated { implicit request =>
    Async {
      val user = request.user
      if (!Experiment.hasOpenExperiment(request.user, true)) {
        Task.nextTaskForUser(request.user).asPromise.map {
          case Some(task) =>
            val experiment = Experiment.createExperimentFor(user, task)
            Task.addExperiment(task, experiment)
            AjaxOk.success(html.user.dashboard.taskExperimentTableItem(task, experiment), Messages("task.new"))
          case _ =>
            Training.findAllFor(user).headOption.map { task =>
              val experiment = Experiment.createExperimentFor(user, task)
              Task.addExperiment(task, experiment)
              AjaxOk.success(html.user.dashboard.taskExperimentTableItem(task, experiment), Messages("training.new"))
            } getOrElse AjaxBadRequest.error(Messages("task.unavailable"))
        }
      } else
        Promise.pure(AjaxBadRequest.error(Messages("task.alreadyHasOpenOne")))
    }
  }

  def finish(experimentId: String) = Authenticated { implicit request =>
    Experiment
      .findOneById(experimentId)
      .filter(_._user == request.user._id)
      .map { experiment =>
        if (experiment.isTrainingsExperiment) {
          val alteredExp = experiment.update(_.passToReview)
          experiment.taskId.flatMap(Task.findOneById).map { task =>
            AjaxOk.success(html.user.dashboard.taskExperimentTableItem(task, alteredExp), Messages("task.passedToReview"))
          } getOrElse BadRequest(Messages("task.notFound"))
        } else {
          val alteredExp = experiment.update(_.finish)
          experiment.taskId.flatMap(Task.findOneById).map { task =>
            AjaxOk.success(html.user.dashboard.taskExperimentTableItem(task, alteredExp), Messages("task.finished"))
          } getOrElse BadRequest(Messages("task.notFound"))
        }
      } getOrElse BadRequest(Messages("experiment.notFound"))
  }
}