package controllers

import oxalis.security.Secured
import models.user._
import models.task._
import models.annotation._
import play.api.libs.json.Json._
import play.api.libs.json._
import play.api.i18n.Messages
import oxalis.user.UserCache
import play.api.libs.concurrent.Execution.Implicits._
import views._
import com.scalableminds.util.tools.ExtendedTypes.ExtendedList
import com.scalableminds.util.tools.ExtendedTypes.ExtendedBoolean
import play.api.Logger
import models.binary.DataSet
import scala.concurrent.Future
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.team.TeamMembership
import play.api.libs.functional.syntax._
import play.api.templates.Html
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import models.user.time.{TimeSpanService, TimeSpan}

object UserController extends Controller with Secured with Dashboard {

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  // TODO: find a better way to ignore parameters
  def emptyWithWildcard(param: String) = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  def current =  Authenticated { implicit request =>
    Ok(Json.toJson(request.user)(User.userPublicWrites(request.user)))
  }

  def user(userId: String) =  Authenticated.async { implicit request =>
    for {
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
    } yield {
      Ok(Json.toJson(user)(User.userPublicWrites(request.user)))
    }
  }

  def annotations = Authenticated.async { implicit request =>
    for {
      content <- dashboardInfo(request.user, request.user)
    } yield {
      JsonOk(content)
    }
  }

  def userLoggedTime(userId: String) = Authenticated.async{ implicit request =>
    for {
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      loggedTimeAsMap <- TimeSpanService.loggedTimeOfUser(user, TimeSpan.groupByMonth _)
    } yield {
      JsonOk(Json.obj("loggedTime" ->
        loggedTimeAsMap.map { case (paymentInterval, duration) =>
          Json.obj("paymentInterval" -> paymentInterval, "durationInSeconds" -> duration.toSeconds)
        }
      ))
    }
  }

  def userAnnotations(userId: String) = Authenticated.async{ implicit request =>
    for {
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      content <- dashboardInfo(user, request.user)
    } yield {
      JsonOk(content)
    }
  }

  def loggedTime = Authenticated.async{ implicit request =>
    for {
      loggedTimeAsMap <- TimeSpanService.loggedTimeOfUser(request.user, TimeSpan.groupByMonth _)
    } yield {
      JsonOk(Json.obj("loggedTime" ->
        loggedTimeAsMap.map { case (paymentInterval, duration) =>
          Json.obj("paymentInterval" -> paymentInterval, "durationInSeconds" -> duration.toSeconds)
        }
      ))
    }
  }

  // REST API
  def list = Authenticated.async{ implicit request =>
    for{
      users <- UserDAO.findAll
    } yield {
      val filtered = request.getQueryString("isEditable").flatMap(_.toBooleanOpt) match{
        case Some(isEditable) =>
          users.filter(_.isEditableBy(request.user) == isEditable)
        case None =>
          users
      }
      Ok(Writes.list(User.userPublicWrites(request.user)).writes(filtered.sortBy(_.lastName.toLowerCase)))
    }
  }

  def logTime(userId: String, time: String, note: String) = Authenticated.async { implicit request =>
    for {
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      _ <- allowedToAdministrate(request.user, user).toFox
      time <- TimeSpan.parseTime(time) ?~> Messages("time.invalidFormat")
    } yield {
      TimeSpanService.logTime(user, time, Some(note))
      JsonOk
    }
  }

  def delete(userId: String) = Authenticated.async { implicit request =>
    for {
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      _ <- allowedToAdministrate(request.user, user).toFox
      _ <- UserService.removeFromAllPossibleTeams(user, request.user)
    } yield {
      JsonOk(Messages("user.deleted", user.name))
    }
  }

  val userUpdateReader =
    ((__ \ "firstName").read[String] and
      (__ \ "lastName").read[String] and
      (__ \ "verified").read[Boolean] and
      (__ \ "teams").read[List[TeamMembership]] and
      (__ \ "experiences").read[Map[String, Int]]).tupled

  def update(userId: String) = Authenticated.async(parse.json) { implicit request =>
    val issuingUser = request.user
    request.body.validate(userUpdateReader) match{
      case JsSuccess((firstName, lastName, verified, assignedTeams, experiences), _) =>
        for{
          user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
          _ <- allowedToAdministrate(issuingUser, user).toFox

        } yield {
          val updatedTeams = assignedTeams.filter(t => issuingUser.adminTeamNames.contains(t.team))
          val teams = user.teams.filterNot(t => updatedTeams.exists(_.team == t.team)) ::: updatedTeams
          UserService.update(user, firstName, lastName, verified, teams, experiences)
          Ok
        }
      case e: JsError =>
        Logger.warn("User update, client sent invalid json: " + e)
        Future.successful(BadRequest(JsError.toFlatJson(e)))
    }
  }

  //  def loginAsUser(userId: String) = Authenticated(permission = Some(Permission("admin.ghost"))).async { implicit request =>
  //    for {
  //      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
  //    } yield {
  //      Redirect(controllers.routes.UserController.dashboard)
  //      .withSession(Secured.createSession(user))
  //    }
  //  }
}
