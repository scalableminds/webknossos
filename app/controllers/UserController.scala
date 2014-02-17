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
import braingames.util.ExtendedTypes.ExtendedList
import braingames.util.ExtendedTypes.ExtendedBoolean
import play.api.Logger
import models.binary.DataSet
import scala.concurrent.Future
import braingames.util.{Fox, FoxImplicits}
import models.user.time.{TimeTracking, TimeTrackingService}
import models.team.TeamMembership
import play.api.libs.functional.syntax._
import play.api.templates.Html
import braingames.util.ExtendedTypes.ExtendedString

object UserController extends Controller with Secured with Dashboard {

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  // HTML actions
  def dashboard = Authenticated.async {
    implicit request => {
      dashboardInfo(request.user).map { info =>
        Ok(html.user.dashboard.userDashboard(info))
      }
    }
  }

  def getDashboardInfo = Authenticated.async {
    implicit request => {
      val futures = dashboardInfo(request.user).map { info =>

        val loggedTime = info.loggedTime.map { case (paymentInterval, duration) =>
          // TODO make formatTimeHumanReadable(duration) (?) work
          Json.obj("paymentInterval" -> paymentInterval, "duration" -> duration.toString)
        }

        for {
          taskList <- Future.traverse(info.tasks)({
            case (task, annotation) =>
              for {
                tasks <- Task.transformToJson(task)
                annotations <- Annotation.transformToJson(annotation)
              } yield (tasks, annotations)
          })
          exploratoryList <- Future.traverse(info.exploratory)(Annotation.transformToJson(_))
        } yield {
          Json.obj(
            "user" -> Json.toJson(info.user)(User.userPublicWrites(request.user)),
            "loggedTime" -> loggedTime,
            "dataSets" -> info.dataSets,
            "hasAnOpenTask" -> info.hasAnOpenTask,
            "exploratory" -> Json.toJson(exploratoryList),
            "tasks" -> Json.toJson(taskList.map(tuple => Json.obj("tasks" -> tuple._1, "annotation" -> tuple._2)))
          )
        }
      }

      futures.flatMap { f =>
        f.map { content => JsonOk(Json.obj("data" -> content)) }
      }

    }
  }

  def show(userId: String) = Authenticated.async { implicit request =>
    for {
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      _ <- allowedToAdministrate(request.user, user).toFox
      loggedTime <- TimeTrackingService.loggedTime(user)
      info <- dashboardInfo(user)
    } yield Ok(html.admin.user.user(info))
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
      Ok(Writes.list(User.userPublicWrites(request.user)).writes(filtered.sortBy(_.lastName)))
    }
  }

  def logTime(userId: String, time: String, note: String) = Authenticated.async { implicit request =>
    for {
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      _ <- allowedToAdministrate(request.user, user).toFox
      time <- TimeTracking.parseTime(time) ?~> Messages("time.invalidFormat")
    } yield {
      TimeTrackingService.logTime(user, time, note)
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
