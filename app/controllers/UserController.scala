package controllers

import javax.inject.Inject
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationSQLDAO, AnnotationTypeSQL}
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

  def current = SecuredAction { implicit request =>
    Ok(Json.toJson(request.identity)(User.userPublicWrites(request.identity)))
  }

  def user(userId: String) = SecuredAction.async { implicit request =>
    for {
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      _ <- user.isEditableBy(request.identity) ?~> Messages("notAllowed")
    } yield {
      Ok(Json.toJson(user)(User.userPublicWrites(request.identity)))
    }
  }

  def annotations(isFinished: Option[Boolean], limit: Option[Int]) = SecuredAction.async { implicit request =>
    for {
      annotations <- AnnotationSQLDAO.findAllFor(ObjectId.fromBsonId(request.identity._id), isFinished, AnnotationTypeSQL.Explorational, limit.getOrElse(defaultAnnotationLimit))
      jsonList <- Fox.serialCombined(annotations)(_.publicWrites(Some(request.identity)))
    } yield {
      Ok(Json.toJson(jsonList))
    }
  }

  def tasks(isFinished: Option[Boolean], limit: Option[Int]) = SecuredAction.async { implicit request =>
    for {
      annotations <- AnnotationSQLDAO.findAllFor(ObjectId.fromBsonId(request.identity._id), isFinished, AnnotationTypeSQL.Task, limit.getOrElse(defaultAnnotationLimit))
      jsonList <- Fox.serialCombined(annotations)(_.publicWrites(Some(request.identity)))
    } yield {
      Ok(Json.toJson(jsonList))
    }
  }

  def userLoggedTime(userId: String) = SecuredAction.async { implicit request =>
    for {
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      _ <- user.isEditableBy(request.identity) ?~> Messages("notAllowed")
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
    (timeSpan.annotation.getOrElse("<none>"), TimeSpan.groupByDay(timeSpan))
  }

  def usersLoggedTime = SecuredAction.async(parse.json) { implicit request =>
    request.body.validate[TimeSpanRequest] match {
      case JsSuccess(timeSpanRequest, _) =>
        Fox.combined(timeSpanRequest.users.map { userId =>
          for {
            user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
            _ <- user.isEditableBy(request.identity) ?~> Messages("notAllowed")
            result <- TimeSpanService.loggedTimeOfUser(user, groupByAnnotationAndDay, Some(timeSpanRequest.start), Some(timeSpanRequest.end))
          } yield {
            Json.obj(
              "user" -> Json.obj(
                "userId" -> user.id,
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

      case e: JsError =>
        Future.successful(JsonBadRequest(JsError.toFlatJson(e)))
    }
  }

  def userAnnotations(userId: String, isFinished: Option[Boolean], limit: Option[Int]) = SecuredAction.async { implicit request =>
    for {
      userIdValidated <- ObjectId.parse(userId)
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      _ <- user.isEditableBy(request.identity) ?~> Messages("notAllowed")
      annotations <- AnnotationSQLDAO.findAllFor(userIdValidated, isFinished, AnnotationTypeSQL.Explorational, limit.getOrElse(defaultAnnotationLimit))
      jsonList <- Fox.serialCombined(annotations)(_.publicWrites(Some(request.identity)))
    } yield {
      Ok(Json.toJson(jsonList))
    }
  }

  def userTasks(userId: String, isFinished: Option[Boolean], limit: Option[Int]) = SecuredAction.async { implicit request =>
    for {
      userIdValidated <- ObjectId.parse(userId)
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      _ <- user.isEditableBy(request.identity) ?~> Messages("notAllowed")
      annotations <- AnnotationSQLDAO.findAllFor(userIdValidated, isFinished, AnnotationTypeSQL.Task, limit.getOrElse(defaultAnnotationLimit))
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

  // REST API
  def list = SecuredAction.async { implicit request =>
    UsingFilters(
      Filter("includeAnonymous", (value: Boolean, el: User) => value || !el.isAnonymous, default = Some("false")),
      Filter("isEditable", (value: Boolean, el: User) => el.isEditableBy(request.identity) == value),
      Filter("isAdmin", (value: Boolean, el: User) => el.isAdmin == value)
    ) { filter =>
      for {
        users <- UserDAO.findAll
        filtered = filter.applyOn(users)
      } yield {
        Ok(Writes.list(User.userPublicWrites(request.identity)).writes(filtered.sortBy(_.lastName.toLowerCase)))
      }
    }
  }

  def logTime(userId: String, time: String, note: String) = SecuredAction.async { implicit request =>
    for {
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      _ <- user.isEditableBy(request.identity) ?~> Messages("notAllowed")
      time <- TimeSpan.parseTime(time) ?~> Messages("time.invalidFormat")
    } yield {
      TimeSpanService.logTime(user, time, Some(note))
      JsonOk
    }
  }

  val userUpdateReader =
    ((__ \ "firstName").read[String] and
      (__ \ "lastName").read[String] and
      (__ \ "email").read[String] and
      (__ \ "isActive").read[Boolean] and
      (__ \ "isAdmin").read[Boolean] and
      (__ \ "teams").read[List[TeamMembership]](Reads.list(TeamMembership.teamMembershipPublicReads)) and
      (__ \ "experiences").read[Map[String, Int]]).tupled

  def ensureProperTeamAdministration(user: User, teams: List[(TeamMembership, Team)]) = {
    Fox.combined(teams.map {
      case (TeamMembership(_, _, true), team) if (!team.couldBeAdministratedBy(user)) =>
        Fox.failure(Messages("team.admin.notPossibleBy", team.name, user.name))
      case (_, team) =>
        Fox.successful(team)
    })
  }

  private def checkAdminOnlyUpdates(user: User, isActive: Boolean, isAdmin: Boolean, email: String)(issuingUser: User): Boolean = {
    if (user.isActive == isActive && user.isAdmin == isAdmin && user.email == email) true
    else issuingUser.isAdminOf(user)
  }

  def update(userId: String) = SecuredAction.async(parse.json) { implicit request =>
    val issuingUser = request.identity
    withJsonBodyUsing(userUpdateReader) {
      case (firstName, lastName, email, isActive, isAdmin, assignedMemberships, experiences) =>
        for {
          user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
          _ <- user.isEditableBy(request.identity) ?~> Messages("notAllowed")
          _ <- checkAdminOnlyUpdates(user, isActive, isAdmin, email)(issuingUser) ?~> Messages("notAllowed")
          teams <- Fox.combined(assignedMemberships.map(t => TeamDAO.findOneById(t._id)(GlobalAccessContext) ?~> Messages("team.notFound")))
          allTeams <- Fox.serialSequence(user.teams)(t => TeamDAO.findOneById(t._id)(GlobalAccessContext)).map(_.flatten)
          teamsWithoutUpdate <- Fox.filterNot(user.teams)(t => issuingUser.isTeamManagerOrAdminOf(t._id))
          assignedMembershipWTeams = assignedMemberships.zip(teams)
          teamsWithUpdate <- Fox.filter(assignedMembershipWTeams)(t => issuingUser.isTeamManagerOrAdminOf(t._1._id))
          _ <- ensureProperTeamAdministration(user, teamsWithUpdate)
          trimmedExperiences = experiences.map { case (key, value) => key.trim -> value }
          updatedTeams = teamsWithUpdate.map(_._1) ++ teamsWithoutUpdate
          updatedUser <- UserService.update(user, firstName.trim, lastName.trim, email, isActive, isAdmin, updatedTeams, trimmedExperiences)
        } yield {
          Ok(User.userPublicWrites(request.identity).writes(updatedUser))
        }
    }
  }

}
