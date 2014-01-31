package controllers.admin

import models.task.{TaskSelectionAlgorithmDAO, TaskSelectionAlgorithm}
import play.api.libs.json.Json
import views.html
import play.api.i18n.Messages
import braingames.util.ExtendedTypes.ExtendedBoolean
import play.api.libs.concurrent.Execution.Implicits._

object TaskAlgorithm extends AdminController {

  def testAlgorithm = Authenticated(parse.urlFormEncoded) { implicit request =>
    for {
      code <- postParameter("code") ?~ Messages("taskAlgorithm.notSupplied")
      _ <- (TaskSelectionAlgorithm.isValidAlgorithm(code) failIfFalse Messages("taskAlgorithm.invalid")) ~> 422
    } yield {
      Ok
    }
  }

  def index = Authenticated.async { implicit request =>
    for {
      algorithms <- TaskSelectionAlgorithmDAO.findAll
      current <- TaskSelectionAlgorithmDAO.current
    } yield {
      Ok(html.admin.task.taskSelectionAlgorithm(algorithms, current))
    }
  }

  def submitAlgorithm = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    (for {
      code <- postParameter("code") ?~> Messages("taskAlgorithm.notSupplied")
      use <- postParameter("use") ?~> Messages("taskAlgorithm.use.notSupplied")
      if(TaskSelectionAlgorithm.isValidAlgorithm(code))
      alg = TaskSelectionAlgorithm(code)
      _ <- TaskSelectionAlgorithmDAO.insert(alg)
    } yield {
      if (use == "1")
        TaskSelectionAlgorithmDAO.use(alg)
      Ok
    }) ?~> Messages("taskAlgorithm.invalid") ~> 422
  }

  def useAlgorithm(id: String) = Authenticated.async { implicit request =>
    for {
      algorithm <- TaskSelectionAlgorithmDAO.findOneById(id) ?~> Messages("taskAlgorithm.notFound")
    } yield {
      TaskSelectionAlgorithmDAO.use(algorithm)
      Ok
    }
  }

  def listAlgorithms = Authenticated.async { implicit request =>
    TaskSelectionAlgorithmDAO.findAll.map { algorithms =>
      Ok(Json.toJson(algorithms))
    }
  }
}