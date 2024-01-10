package controllers

import java.text.SimpleDateFormat
import java.util.Calendar
import play.silhouette.api.Silhouette
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}

import javax.inject.Inject
import models.user._
import models.user.time.{TimeSpan, TimeSpanDAO, TimeSpanService}
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.{Action, AnyContent}
import security.WkEnv
import utils.ObjectId

import scala.concurrent.ExecutionContext

class TimeController @Inject()(userService: UserService,
                               userDAO: UserDAO,
                               timeSpanDAO: TimeSpanDAO,
                               timeSpanService: TimeSpanService,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def userLoggedTime(userId: String, onlyCountTasks: Option[Boolean] // defaults to false
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        userIdValidated <- ObjectId.fromString(userId) ?~> "user.id.invalid"
        user <- userDAO.findOne(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        loggedTimeAsMap <- timeSpanService.loggedTimeOfUser(user,
                                                            TimeSpan.groupByMonth,
                                                            onlyCountTasks.getOrElse(false))
      } yield {
        JsonOk(
          Json.obj("loggedTime" ->
            loggedTimeAsMap.map {
              case (paymentInterval, duration) =>
                Json.obj("paymentInterval" -> paymentInterval, "durationInSeconds" -> duration.toSeconds)
            }))
      }
    }

  def getWorkingHoursOfAllUsers(year: Int,
                                month: Int,
                                startDay: Option[Int],
                                endDay: Option[Int],
                                onlyCountTasks: Option[Boolean] // defaults to true
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        users <- userDAO.findAll
        filteredUsers <- Fox.filter(users)(user => userService.isTeamManagerOrAdminOf(request.identity, user))
        js <- getTimeSpansOfUsersForMonthJs(filteredUsers,
                                            year,
                                            month,
                                            startDay,
                                            endDay,
                                            onlyCountTasks.getOrElse(true))
      } yield Ok(js)
    }

  def getWorkingHoursOfUsers(userString: String,
                             year: Int,
                             month: Int,
                             startDay: Option[Int],
                             endDay: Option[Int],
                             onlyCountTasks: Option[Boolean] // defaults to true
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        users <- Fox.combined(
          userString
            .split(",")
            .toList
            .map(email => userService.findOneByEmailAndOrganization(email, request.identity._organization))) ?~> "user.email.invalid"
        _ <- Fox.combined(users.map(user => Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, user)))) ?~> "user.notAuthorised" ~> FORBIDDEN
        js <- getTimeSpansOfUsersForMonthJs(users, year, month, startDay, endDay, onlyCountTasks.getOrElse(true))
      } yield Ok(js)
    }

  def getWorkingHoursOfUser(userId: String,
                            startDate: Long,
                            endDate: Long,
                            onlyCountTasks: Option[Boolean]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        userIdValidated <- ObjectId.fromString(userId)
        user <- userService.findOneCached(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOf(request.identity, user)
        _ <- bool2Fox(isTeamManagerOrAdmin || user._id == request.identity._id) ?~> "user.notAuthorised" ~> FORBIDDEN
        js <- getUserTimeSpansJs(user, Instant(startDate), Instant(endDate), onlyCountTasks.getOrElse(true))
      } yield Ok(js)
    }

  private def getTimeSpansOfUsersForMonthJs(users: List[User],
                                            year: Int,
                                            month: Int,
                                            startDay: Option[Int],
                                            endDay: Option[Int],
                                            onlyCountTasks: Boolean): Fox[JsValue] = {
    lazy val startDate = Calendar.getInstance()
    lazy val endDate = Calendar.getInstance()

    val input = new SimpleDateFormat("yy")
    val output = new SimpleDateFormat("yyyy")
    val date = input.parse(year.toString)
    val fullYear = output.format(date).toInt

    //set them here to first day of selected month so getActualMaximum below will use the correct month entry
    startDate.set(fullYear, month - 1, 1, 0, 0, 0)
    endDate.set(fullYear, month - 1, 1, 0, 0, 0)

    val sDay = startDay.getOrElse(startDate.getActualMinimum(Calendar.DAY_OF_MONTH))
    val eDay = endDay.getOrElse(endDate.getActualMaximum(Calendar.DAY_OF_MONTH))

    startDate.set(fullYear, month - 1, sDay, 0, 0, 0)
    startDate.set(Calendar.MILLISECOND, 0)
    endDate.set(fullYear, month - 1, eDay, 23, 59, 59)
    endDate.set(Calendar.MILLISECOND, 999)

    for {
      userTimeSpansJsList: Seq[JsObject] <- Fox.serialCombined(users)(user =>
        getUserTimeSpansJs(user, Instant.fromCalendar(startDate), Instant.fromCalendar(endDate), onlyCountTasks))
    } yield Json.toJson(userTimeSpansJsList)
  }

  private def getUserTimeSpansJs(user: User, start: Instant, end: Instant, onlyCountTasks: Boolean): Fox[JsObject] =
    for {
      userJs <- userService.compactWrites(user)
      timeSpansJs <- timeSpanDAO.findAllByUserWithTask(user._id, start, end, onlyCountTasks)
    } yield Json.obj("user" -> userJs, "timelogs" -> timeSpansJs)

}
