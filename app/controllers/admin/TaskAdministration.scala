package controllers.admin

import play.api.mvc.Controller
import play.api.mvc.Action
import brainflight.security.Secured
import views.html
import models.User
import models.Task
import models.DataSet
import models.TaskType
import models.graph.Experiment
import controllers.Application
import brainflight.mail.Send
import brainflight.mail.DefaultMails
import models.TimeSpan
import brainflight.tools.ExtendedTypes._

object TaskAdministration extends Controller with Secured {
  def list = Authenticated { implicit request =>
    Ok(html.admin.taskList(request.user, Task.findAll, TaskType.findAll))
  }
  
  def types = Authenticated { implicit request =>
    Ok(html.admin.taskTypes(request.user, TaskType.findAll))
  }

  def create = Authenticated { implicit request =>
    Ok(html.admin.taskCreate(request.user, Experiment.findAllTemporary, TaskType.findAll))
  }
  
  def createType = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    (for {
      summary <- request.body.get("summary").flatMap(_.headOption)
      description <- request.body.get("description").flatMap(_.headOption)
      minTime <- request.body.get("minTime").flatMap(_.headOption.flatMap(_.toIntOpt))
      maxTime <- request.body.get("maxTime").flatMap(_.headOption.flatMap(_.toIntOpt))
      maxHard <- request.body.get("maxHard").flatMap(_.headOption.flatMap(_.toIntOpt))
    } yield {
      val t = TaskType(summary,
        description,
        TimeSpan(minTime, maxTime, maxHard))
      TaskType.insert(t)
      Ok(t.toString)
    }) getOrElse BadRequest("Missing parameters.")
  }

  def createFromExperiment = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    (for {
      eId <- request.body.get("experiment").flatMap(_.headOption)
      priority <- request.body.get("priority").flatMap(_.headOption.flatMap(_.toIntOpt))
      instances <- request.body.get("instances").flatMap(_.headOption.flatMap(_.toIntOpt))
      taskTypeId <- request.body.get("taskType").flatMap(_.headOption)
      taskType <- TaskType.findOneById(taskTypeId)
      e <- Experiment.findOneById(eId)
    } yield {
      val t = Task(e.dataSetName,
        0,
        0,
        taskType._id,
        e.editPosition,
        priority,
        instances)
      Task.insert(t)
      Ok(t.toString)
    }) getOrElse BadRequest("Missing parameters.")
  }
}