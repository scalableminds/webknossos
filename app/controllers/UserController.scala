package controllers

import com.scalableminds.util.security.SCrypt._
import oxalis.security.Secured
import models.user._
import play.api.data._
import play.api.data.Forms._
import play.api.libs.json.Json._
import play.api.libs.json._
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.ExtendedTypes.ExtendedList
import com.scalableminds.util.tools.ExtendedTypes.ExtendedBoolean
import play.api.Logger
import views.html
import scala.concurrent.Future
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.team._
import play.api.libs.functional.syntax._
import play.twirl.api.Html
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import models.user.time._

import scala.text

object UserController extends Controller with Secured with Dashboard with FoxImplicits{

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html("")))
  }

  // TODO: find a better way to ignore parameters
  def emptyWithWildcard(param: String) = Authenticated{ implicit request =>
    Ok(views.html.main()(Html("")))
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

  def ensureProperTeamAdministration(user: User, teams: List[(TeamMembership, Team)]) = {
    Fox.combined(teams.map{
      case (TeamMembership(_, Role.Admin), team) if !team.couldBeAdministratedBy(user) =>
        Fox.failure(Messages("team.admin.notPossibleBy", team.name, user.name))
      case (_, team) =>
        Fox.successful(team)
    })
  }

  def ensureRoleExistence(teams: List[(TeamMembership, Team)]) = {
    Fox.combined(teams.map{
      case (TeamMembership(_, role), team) if !team.roles.contains(role) =>
        Fox.failure(Messages("team.nonExistentRole", team.name, role.name))
      case (_, team) =>
        Fox.successful(team)
    })
  }

  def update(userId: String) = Authenticated.async(parse.json) { implicit request =>
    val issuingUser = request.user
    request.body.validate(userUpdateReader) match{
      case JsSuccess((firstName, lastName, verified, assignedTeams, experiences), _) =>
        for{
          user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
          _ <- allowedToAdministrate(issuingUser, user).toFox
          _ <- Fox.combined(assignedTeams.map(t => ensureTeamAdministration(issuingUser, t.team)toFox))
          teams <- Fox.combined(assignedTeams.map(t => TeamDAO.findOneByName(t.team))) ?~> Messages("team.notFound")
          allTeams <- Fox.sequenceOfFulls(user.teams.map(t => TeamDAO.findOneByName(t.team)))
          _ <- ensureRoleExistence(assignedTeams.zip(teams))
          _ <- ensureProperTeamAdministration(user, assignedTeams.zip(teams))
        } yield {
          val trimmedExperiences = experiences.map{ case (key, value) => key.trim -> value}

          val teamsWithoutUpdate = allTeams.filterNot{t =>
            t.isEditableBy(issuingUser) || assignedTeams.find(_.team == t.name).isDefined
          }
          val updatedTeams = assignedTeams ++ user.teams.filter(teamsWithoutUpdate.contains)

          UserService.update(user, firstName, lastName, verified, updatedTeams, trimmedExperiences)
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

  val resetForm: Form[(String, String)] = {

    def resetFormApply(oldPassword: String, password: Tuple2[String, String]) =
      (oldPassword, password._1)

    def resetFormUnapply(user: (String, String)) =
      Some(user._1, ("", ""))

    val passwordField = tuple("main" -> nonEmptyText, "validation" -> nonEmptyText)
      .verifying("user.password.nomatch", pw => pw._1 == pw._2)
      .verifying("user.password.tooshort", pw => pw._1.length >= 6)

    Form(mapping(
      "password_old" -> nonEmptyText,
      "password" -> passwordField)(resetFormApply)(resetFormUnapply))
  }

  /**
   * Reset password page
   */
  def resetPassword = Authenticated { implicit request =>
    Ok(html.user.reset_password(resetForm))
  }

  def handleResetPassword = Authenticated.async { implicit request =>

    resetForm.bindFromRequest.fold(
      formWithErrors =>
        Future.successful(BadRequest(html.user.reset_password(formWithErrors))), {
        case (oldPassword, newPassword) => {
          val email = request.user.email.toLowerCase
          for {
            user <- UserService.auth(email, oldPassword).getOrElse(User.createNotVerifiedUser)
            ok <- if(user.verified) UserService.changePassword(user, newPassword).map(_.ok) else Some(false).toFox
          } yield {
            if(ok) {
              Redirect (controllers.routes.Authentication.logout).flashing(FlashSuccess (Messages ("user.resetPassword.success") ) )
            } else
              BadRequest(html.user.reset_password(resetForm.bindFromRequest.withGlobalError("user.resetPassword.failed")))
          }
      }
    }
    )
  }
}
