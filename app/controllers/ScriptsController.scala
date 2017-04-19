package controllers

import javax.inject.Inject

import com.scalableminds.util.tools.FoxImplicits
import models.task.{Script, _}
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._
import play.api.libs.json._
import play.twirl.api.Html


class ScriptsController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured with FoxImplicits {

  val scriptPublicReads =
    ((__ \ 'name).read[String](minLength[String](2) or maxLength[String](50)) and
      (__ \ 'gist).read[String] and
      (__ \ 'ownerId).read[String]) (Script.fromForm _)

  def empty(id: String) = Authenticated { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def create = Authenticated.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { script =>
      for {
        _ <- request.user.hasAdminAccess ?~> Messages("notAllowed")
        _ <- ScriptDAO.insert(script)
      } yield {
        Ok(Script.scriptPublicWrites.writes(script))
      }
    }
  }

  def get(scriptId: String) = Authenticated.async { implicit request =>
    for {
      script <- ScriptDAO.findOneById(scriptId) ?~> Messages("script.notFound")
    } yield {
      Ok(Script.scriptPublicWrites.writes(script))
    }
  }

  def list = Authenticated.async { implicit request =>
    for {
      _ <- request.user.hasAdminAccess ?~> Messages("notAllowed")
      scripts <- ScriptDAO.findAll
    } yield {
      Ok(Writes.list(Script.scriptPublicWrites).writes(scripts))
    }
  }

  def update(scriptId: String) = Authenticated.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { script =>
      for {
        oldScript <- ScriptDAO.findOneById(scriptId) ?~> Messages("script.notFound")
        _ <- (oldScript._owner == request.user.id) ?~> Messages("script.notOwner")
        _ <- ScriptDAO.update(oldScript._id, script.copy(_id = oldScript._id))
      } yield {
        Ok(Script.scriptPublicWrites.writes(script))
      }
    }
  }

  def delete(scriptId: String) = Authenticated.async { implicit request =>
    for {
      oldScript <- ScriptDAO.findOneById(scriptId) ?~> Messages("script.notFound")
      _ <- (oldScript._owner == request.user.id) ?~> Messages("script.notOwner")
      _ <- ScriptDAO.removeById(scriptId) ?~> Messages("script.notFound")
      _ <- TaskService.removeScriptFromTasks(scriptId) ?~> Messages("script.taskRemoval.failed")
    } yield {
      Ok
    }
  }
}
