package controllers.admin

import models.task.{TaskSelectionAlgorithmDAO, TaskSelectionAlgorithm}
import play.api.libs.json.Json
import views.html
import play.api.i18n.Messages
import braingames.util.ExtendedTypes.ExtendedBoolean
import braingames.util.ExtendedTypes.ExtendedString
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.templates.Html

object TaskAlgorithm extends AdminController {

  def testAlgorithm = Authenticated(parse.urlFormEncoded) { implicit request =>
    for {
      code <- postParameter("code") ?~ Messages("taskAlgorithm.notSupplied")
      _ <- (TaskSelectionAlgorithm.isValidAlgorithm(code) failIfFalse Messages("taskAlgorithm.invalid")) ~> 422
    } yield {
      Ok
    }
  }

  def index = Authenticated { implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  // def create = Authenticated.async(parse.json){ implicit request =>
  //   (for {
  //     code <- postParameter("code") ?~> Messages("taskAlgorithm.notSupplied")
  //     use <- postParameter("use") ?~> Messages("taskAlgorithm.use.notSupplied")
  //     if(TaskSelectionAlgorithm.isValidAlgorithm(code))
  //     alg = TaskSelectionAlgorithm(code)
  //     _ <- TaskSelectionAlgorithmDAO.insert(alg)
  //   } yield {
  //     if (use == "1")
  //       TaskSelectionAlgorithmDAO.use(alg)
  //     Ok
  //   }) ?~> Messages("taskAlgorithm.invalid") ~> 422
  // }

  def list = Authenticated.async { implicit request =>
    for {
      algorithms <- TaskSelectionAlgorithmDAO.findAll
    } yield {
      val filtered = request.getQueryString("isActive").flatMap(_.toBooleanOpt) match{
        case Some(isActive) =>
          algorithms.filter(_.isActive == isActive)
        case None =>
          algorithms
      }
      Ok(Writes.list[TaskSelectionAlgorithm].writes(filtered))
    }
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