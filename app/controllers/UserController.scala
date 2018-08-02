package controllers

import javax.inject.Inject
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.mvc.Filter
import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationType}
import models.team._
import models.user._
import models.user.time._
import oxalis.security.WebknossosSilhouette.{SecuredAction, SecuredRequest, UserAwareAction, UserAwareRequest}
import play.api.data.Forms._
import play.api.data._
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.Json._
import play.api.libs.json._
import play.twirl.api.Html
import utils.ObjectId
import views.html

import scala.concurrent.Future

class UserController @Inject()(val messagesApi: MessagesApi)
  extends Controller
    with FoxImplicits {

  val defaultAnnotationLimit = 1000

  def current = SecuredAction.async { implicit request =>
    for {
      userJs <- request.identity.publicWrites(request.identity)
    } yield Ok(userJs)
  }

  def user(userId: String) = SecuredAction.async { implicit request =>
    for {
      userIdValidated <- ObjectId.parse(userId)
      user <- UserDAO.findOne(userIdValidated) ?~> Messages("user.notFound")
      _ <- Fox.assertTrue(user.isEditableBy(request.identity)) ?~> Messages("notAllowed")
      js <- user.publicWrites(request.identity)
    } yield Ok(js)
  }

  def annotations(isFinished: Option[Boolean], limit: Option[Int]) = SecuredAction.async { implicit request =>
    for {
      annotations <- AnnotationDAO.findAllFor(request.identity._id, isFinished, AnnotationType.Explorational, limit.getOrElse(defaultAnnotationLimit))
      jsonList <- Fox.serialCombined(annotations)(_.publicWrites(Some(request.identity)))
    } yield {
      Ok(Json.toJson(jsonList))
    }
  }

  def tasks(isFinished: Option[Boolean], limit: Option[Int]) = SecuredAction.async { implicit request =>
    for {
      annotations <- AnnotationDAO.findAllFor(request.identity._id, isFinished, AnnotationType.Task, limit.getOrElse(defaultAnnotationLimit))
      jsonList <- Fox.serialCombined(annotations)(_.publicWrites(Some(request.identity)))
    } yield {
      Ok(Json.toJson(jsonList))
    }
  }

  def userLoggedTime(userId: String) = SecuredAction.async { implicit request =>
    for {
      userIdValidated <- ObjectId.parse(userId)
      user <- UserDAO.findOne(userIdValidated) ?~> Messages("user.notFound")
      _ <- Fox.assertTrue(user.isEditableBy(request.identity)) ?~> Messages("notAllowed")
      loggedTimeAsMap <- TimeSpanService.loggedTimeOfUser(user, TimeSpan.groupByMonth)
    } yield {
      JsonOk(Json.obj("loggedTime" ->
        loggedTimeAsMap.map { case (paymentInterval, duration) =>
          Json.obj("paymentInterval" -> paymentInterval, "durationInSeconds" -> duration.toSeconds)
        }
      ))
    }
  }

  private def groupByAnnotationAndDay(timeSpan: TimeSpan) = {
    (timeSpan._annotation.map(_.toString).getOrElse("<none>"), TimeSpan.groupByDay(timeSpan))
  }

  def usersLoggedTime = SecuredAction.async(validateJson[TimeSpanRequest]) { implicit request =>
    Fox.combined(request.body.users.map { userId =>
      for {
        userIdValidated <- ObjectId.parse(userId)
        user <- UserDAO.findOne(userIdValidated) ?~> Messages("user.notFound")
        _ <- Fox.assertTrue(user.isEditableBy(request.identity)) ?~> Messages("notAllowed")
        result <- TimeSpanService.loggedTimeOfUser(user, groupByAnnotationAndDay, Some(request.body.start), Some(request.body.end))
      } yield {
        Json.obj(
          "user" -> Json.obj(
            "userId" -> user._id.toString,
            "firstName" -> user.firstName,
            "lastName" -> user.lastName,
            "email" -> user.email
          ),
          "loggedTime" -> result.map {
            case ((annotation, day), duration) =>
              Json.obj(
                "annotation" -> annotation,
                "day" -> day,
                "durationInSeconds" -> duration.toSeconds
              )
          }
        )
      }
    }).map(loggedTime => Ok(Json.toJson(loggedTime)))
  }

  def userAnnotations(userId: String, isFinished: Option[Boolean], limit: Option[Int]) = SecuredAction.async { implicit request =>
    for {
      userIdValidated <- ObjectId.parse(userId)
      user <- UserDAO.findOne(userIdValidated) ?~> Messages("user.notFound")
      _ <- Fox.assertTrue(user.isEditableBy(request.identity)) ?~> Messages("notAllowed")
      annotations <- AnnotationDAO.findAllFor(userIdValidated, isFinished, AnnotationType.Explorational, limit.getOrElse(defaultAnnotationLimit))
      jsonList <- Fox.serialCombined(annotations)(_.publicWrites(Some(request.identity)))
    } yield {
      Ok(Json.toJson(jsonList))
    }
  }

  def userTasks(userId: String, isFinished: Option[Boolean], limit: Option[Int]) = SecuredAction.async { implicit request =>
    for {
      userIdValidated <- ObjectId.parse(userId)
      user <- UserDAO.findOne(userIdValidated) ?~> Messages("user.notFound")
      _ <- Fox.assertTrue(user.isEditableBy(request.identity)) ?~> Messages("notAllowed")
      annotations <- AnnotationDAO.findAllFor(userIdValidated, isFinished, AnnotationType.Task, limit.getOrElse(defaultAnnotationLimit))
      jsonList <- Fox.serialCombined(annotations)(_.publicWrites(Some(request.identity)))
    } yield {
      Ok(Json.toJson(jsonList))
    }
  }

  def loggedTime = SecuredAction.async { implicit request =>
    for {
      loggedTimeAsMap <- TimeSpanService.loggedTimeOfUser(request.identity, TimeSpan.groupByMonth)
    } yield {
      JsonOk(Json.obj("loggedTime" ->
        loggedTimeAsMap.map { case (paymentInterval, duration) =>
          Json.obj("paymentInterval" -> paymentInterval, "durationInSeconds" -> duration.toSeconds)
        }
      ))
    }
  }

  def list = SecuredAction.async { implicit request =>
    UsingFilters(
      Filter("isEditable", (value: Boolean, el: User) => for {isEditable <- el.isEditableBy(request.identity)} yield isEditable == value),
      Filter("isAdmin", (value: Boolean, el: User) => Fox.successful(el.isAdmin == value))
    ) { filter =>
      for {
        users <- UserDAO.findAll
        filtered <- filter.applyOn(users)
        js <- Fox.serialCombined(filtered.sortBy(_.lastName.toLowerCase))(u => u.publicWrites(request.identity))
      } yield {
        Ok(Json.toJson(js))
      }
    }
  }

  val userUpdateReader =
    ((__ \ "firstName").read[String] and
      (__ \ "lastName").read[String] and
      (__ \ "email").read[String] and
      (__ \ "isActive").read[Boolean] and
      (__ \ "isAdmin").read[Boolean] and
      (__ \ "teams").read[List[TeamMembershipSQL]](Reads.list(TeamMembershipSQL.publicReads)) and
      (__ \ "experiences").read[Map[String, Int]]).tupled

  def ensureProperTeamAdministration(user: User, teams: List[(TeamMembershipSQL, Team)]) = {
    Fox.combined(teams.map {
      case (TeamMembershipSQL(_, true), team) => {
        for {
          _ <- bool2Fox(team.couldBeAdministratedBy(user)) ?~> Messages("team.admin.notPossibleBy", team.name, user.name)
        }
        yield ()
      }
      case (_, team) =>
        Fox.successful(())
    })
  }

  private def checkAdminOnlyUpdates(user: User, isActive: Boolean, isAdmin: Boolean, email: String)(issuingUser: User): Boolean = {
    if (user.isDeactivated == !isActive && user.isAdmin == isAdmin && user.email == email) true
    else issuingUser.isAdminOf(user)
  }

  def update(userId: String) = SecuredAction.async(parse.json) { implicit request =>
    val issuingUser = request.identity
    withJsonBodyUsing(userUpdateReader) {
      case (firstName, lastName, email, isActive, isAdmin, assignedMemberships, experiences) =>
        for {
          userIdValidated <- ObjectId.parse(userId)
          user <- UserDAO.findOne(userIdValidated) ?~> Messages("user.notFound")
          _ <- Fox.assertTrue(user.isEditableBy(request.identity)) ?~> Messages("notAllowed")
          _ <- bool2Fox(checkAdminOnlyUpdates(user, isActive, isAdmin, email)(issuingUser)) ?~> Messages("notAllowed")
          teams <- Fox.combined(assignedMemberships.map(t => TeamDAO.findOne(t.teamId)(GlobalAccessContext) ?~> Messages("team.notFound")))
          oldTeamMemberships <- user.teamMemberships
          teamsWithoutUpdate <- Fox.filterNot(oldTeamMemberships)(t => issuingUser.isTeamManagerOrAdminOf(t.teamId))
          assignedMembershipWTeams = assignedMemberships.zip(teams)
          teamsWithUpdate <- Fox.filter(assignedMembershipWTeams)(t => issuingUser.isTeamManagerOrAdminOf(t._1.teamId))
          _ <- ensureProperTeamAdministration(user, teamsWithUpdate)
          trimmedExperiences = experiences.map { case (key, value) => key.trim -> value }
          updatedTeams = teamsWithUpdate.map(_._1) ++ teamsWithoutUpdate
          _ <- UserService.update(user, firstName.trim, lastName.trim, email, isActive, isAdmin, updatedTeams, trimmedExperiences)
          updatedUser <- UserDAO.findOne(userIdValidated)
          updatedJs <- updatedUser.publicWrites(request.identity)
        } yield {
          Ok(updatedJs)
        }
    }
  }

}
