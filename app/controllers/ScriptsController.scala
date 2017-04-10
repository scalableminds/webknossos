package controllers

import javax.inject.Inject

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationSettings}
import models.task._
import models.task.Script
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._
import play.api.libs.json._
import play.twirl.api.Html
import scala.concurrent.Future


class ScriptsController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured with FoxImplicits{

  val scriptPublicReads =
    ((__ \ 'name).read[String](minLength[String](2) or maxLength[String](50)) and
      (__ \ 'gist).read[String]) (Script.fromForm _)

  def empty(id: String) = Authenticated { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def create = Authenticated.async(parse.json) { implicit request =>
    // TODO: security
    withJsonBodyUsing(scriptPublicReads) { script =>
      for {
        _ <- ScriptDAO.insert(script)
      } yield {
        Ok(Json.toJson(script))
      }
    }
  }

  def get(scriptId: String) = Authenticated.async { implicit request =>
    for {
      script <- ScriptDAO.findOneById(scriptId) ?~> Messages("script.notFound")
      // TODO: security
    } yield {
      Ok(Json.toJson(script))
    }
  }

  def list = Authenticated.async { implicit request =>
    for {
      scripts <- ScriptDAO.findAll
      // TODO: security
    } yield {
      Ok(Json.toJson(scripts))
    }
  }

  def update(scriptId: String) = Authenticated.async(parse.json) { implicit request =>
    withJsonBodyUsing(Script.scriptFormat) { script =>
      // TODO: update script
      Future.successful(Ok("updated :)"))
    }
  }

  def delete(scriptId: String) = Authenticated.async { implicit request =>
    for {
      _ <- ScriptDAO.removeById(scriptId) ?~> Messages("script.notFound")
      // TODO: remove script from tasks
    } yield {
      Ok
    }
  }
}
