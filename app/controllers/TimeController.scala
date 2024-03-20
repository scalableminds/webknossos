package controllers

import java.text.SimpleDateFormat
import java.util.Calendar
import play.silhouette.api.Silhouette
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}

import javax.inject.Inject
import models.user._
import models.user.time.TimeSpanDAO
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.{Action, AnyContent}
import security.WkEnv
import utils.ObjectId

import scala.concurrent.ExecutionContext

class TimeController @Inject()(userService: UserService,
                               userDAO: UserDAO,
                               timeSpanDAO: TimeSpanDAO,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  // Note: This route is used by external applications, keep stable
  // all users with working hours > 0
  def getWorkingHoursOfAllUsers(year: Int, month: Int, startDay: Option[Int], endDay: Option[Int]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        users <- userDAO.findAll
        filteredUsers <- Fox.filter(users)(user => userService.isTeamManagerOrAdminOf(request.identity, user))
        js <- loggedTimeForUserListByMonth(filteredUsers, year, month, startDay, endDay)
      } yield Ok(js)
    }

  // Note: This route is used by external applications, keep stable
  // list user with working hours > 0 (only one user is also possible)
  def getWorkingHoursOfUsers(userString: String,
                             year: Int,
                             month: Int,
                             startDay: Option[Int],
                             endDay: Option[Int]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        users <- Fox.combined(
          userString
            .split(",")
            .toList
            .map(email => userService.findOneByEmailAndOrganization(email, request.identity._organization))) ?~> "user.email.invalid"
        _ <- Fox.combined(users.map(user => Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, user)))) ?~> "user.notAuthorised" ~> FORBIDDEN
        js <- loggedTimeForUserListByMonth(users, year, month, startDay, endDay)
      } yield Ok(js)
    }

  def getWorkingHoursOfUser(userId: String, startDate: Long, endDate: Long): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        userIdValidated <- ObjectId.fromString(userId)
        user <- userService.findOneCached(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOf(request.identity, user)
        _ <- bool2Fox(isTeamManagerOrAdmin || user._id == request.identity._id) ?~> "user.notAuthorised" ~> FORBIDDEN
        js <- loggedTimeForUserListByTimestamp(user, startDate, endDate)
      } yield Ok(js)
    }

  private def loggedTimeForUserListByMonth(users: List[User],
                                           year: Int,
                                           month: Int,
                                           startDay: Option[Int],
                                           endDay: Option[Int]): Fox[JsValue] = {
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

    val futureJsObjects = users.map(user => getUserHours(user, startDate, endDate))
    Fox.combined(futureJsObjects).map(jsObjectList => Json.toJson(jsObjectList))
  }

  private def loggedTimeForUserListByTimestamp(user: User, startDate: Long, endDate: Long): Fox[JsValue] = {
    lazy val sDate = Calendar.getInstance()
    lazy val eDate = Calendar.getInstance()

    sDate.setTimeInMillis(startDate)
    eDate.setTimeInMillis(endDate)

    getUserHours(user, sDate, eDate)
  }

  private def getUserHours(user: User, startDate: Calendar, endDate: Calendar): Fox[JsObject] =
    for {
      userJs <- userService.compactWrites(user)
      timeJs <- timeSpanDAO.findAllByUserWithTask(user._id,
                                                  Some(Instant.fromCalendar(startDate)),
                                                  Some(Instant.fromCalendar(endDate)))
    } yield Json.obj("user" -> userJs, "timelogs" -> timeJs)

}
