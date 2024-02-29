package controllers

import java.text.SimpleDateFormat
import play.silhouette.api.Silhouette
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType
import models.annotation.AnnotationType.AnnotationType

import javax.inject.Inject
import models.user._
import models.user.time.{Day, Interval, Month, TimeSpan, TimeSpanDAO, TimeSpanService}
import net.liftweb.common.Box
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, Json}
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

  // Called by webknossos-libs client. Sums monthly. Includes exploratives
  def userLoggedTime(userId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        userIdValidated <- ObjectId.fromString(userId) ?~> "user.id.invalid"
        user <- userDAO.findOne(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        timeSpansBox: Box[List[TimeSpan]] <- timeSpanDAO.findAllByUser(user._id).futureBox
        loggedTimeAsMap = timeSpanService.sumTimespansPerInterval(TimeSpan.groupByMonth, timeSpansBox)
      } yield {
        JsonOk(
          Json.obj("loggedTime" ->
            loggedTimeAsMap.map {
              case (paymentInterval, duration) =>
                Json.obj("paymentInterval" -> paymentInterval, "durationInSeconds" -> duration.toSeconds)
            }))
      }
    }

  // Legacy, called by braintracing
  def timeSpansOfAllUsers(year: Int, month: Int, startDay: Option[Int], endDay: Option[Int]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        users <- userDAO.findAll
        filteredUsers <- Fox.filter(users)(user => userService.isTeamManagerOrAdminOf(request.identity, user))
        adaptedYear = adaptTwoDigitYear(year)
        start = startDay.map(sd => Day(sd, month, adaptedYear)).getOrElse(Month(month, adaptedYear)).start
        end = endDay.map(ed => Day(ed, month, adaptedYear)).getOrElse(Month(month, adaptedYear)).end
        userTimeSpansJsList: Seq[JsObject] <- Fox.serialCombined(filteredUsers)(user =>
          getUserTimeSpansJs(user, start, end, List(AnnotationType.Task), projectIdsOpt = None))
      } yield Ok(Json.toJson(userTimeSpansJsList))
    }

  // Legacy, called by braintracing
  def timeSpansOfUsers(userString: String, year: Int, month: Int, startDay: Option[Int], endDay: Option[Int],
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        users <- Fox.combined(
          userString
            .split(",")
            .toList
            .map(email => userService.findOneByEmailAndOrganization(email, request.identity._organization))) ?~> "user.email.invalid"
        _ <- Fox.combined(users.map(user => Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, user)))) ?~> "user.notAuthorised" ~> FORBIDDEN
        adaptedYear = adaptTwoDigitYear(year)
        start = startDay.map(sd => Day(sd, month, adaptedYear)).getOrElse(Month(month, adaptedYear)).start
        end = endDay.map(ed => Day(ed, month, adaptedYear)).getOrElse(Month(month, adaptedYear)).end
        userTimeSpansJsList: Seq[JsObject] <- Fox.serialCombined(users)(user =>
          getUserTimeSpansJs(user, start, end, List(AnnotationType.Task), projectIdsOpt = None))
      } yield Ok(Json.toJson(userTimeSpansJsList))
    }

  private def adaptTwoDigitYear(possiblyTwoDigitYear: Int): Int = {
    // Note that this works both for two-digit and four-digit year input
    val input = new SimpleDateFormat("yy")
    val output = new SimpleDateFormat("yyyy")
    val date = input.parse(possiblyTwoDigitYear.toString)
    output.format(date).toInt
  }

  def timeSpansOfUser(userId: String,
                      startDate: Long,
                      endDate: Long,
                      annotationTypes: String,
                      projectIds: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        userIdValidated <- ObjectId.fromString(userId)
        projectIdsValidated <- Fox.runOptional(projectIds)(parseObjectIds)
        annotationTypesValidated <- parseAnnotationTypes(annotationTypes) ?~> "invalidAnnotationType"
        user <- userService.findOneCached(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOf(request.identity, user)
        _ <- bool2Fox(isTeamManagerOrAdmin || user._id == request.identity._id) ?~> "user.notAuthorised" ~> FORBIDDEN
        js <- getUserTimeSpansJs(user,
                                 Instant(startDate),
                                 Instant(endDate),
                                 annotationTypesValidated,
                                 projectIdsValidated)
      } yield Ok(js)
    }

  private def getUserTimeSpansJs(user: User,
                                 start: Instant,
                                 end: Instant,
                                 annotationTypes: List[AnnotationType],
                                 projectIdsOpt: Option[List[ObjectId]]): Fox[JsObject] =
    for {
      userJs <- userService.compactWrites(user)
      timeSpansJs <- timeSpanDAO.findAllByUserWithTask(user._id, start, end, annotationTypes, projectIdsOpt)
    } yield Json.obj("user" -> userJs, "timelogs" -> timeSpansJs)

  // Used for graph on statistics page. Always includes explorative annotations
  def timeGroupedByInterval(interval: String, start: Option[Long], end: Option[Long]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      intervalGroupingFunctions.get(interval) match {
        case Some(intervalGroupingFunction) =>
          for {
            organizationId <- Fox.successful(request.identity._organization)
            _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOfOrg(request.identity, organizationId)) ?~> "notAllowed" ~> FORBIDDEN
            timeSpansBox: Box[List[TimeSpan]] <- timeSpanDAO
              .findAllByOrganization(start.map(Instant(_)), end.map(Instant(_)), organizationId)
              .futureBox
            timesGrouped = timeSpanService.sumTimespansPerInterval(intervalGroupingFunction, timeSpansBox)
          } yield {
            Ok(
              Json.obj(
                "timeGroupedByInterval" -> timesGrouped.map {
                  case (interval, duration) =>
                    Json.obj(
                      "start" -> interval.start.toString,
                      "end" -> interval.end.toString,
                      "tracingTime" -> duration.toMillis
                    )
                },
              )
            )
          }
        case _ =>
          Fox.successful(BadRequest(Messages("statistics.interval.invalid")))
      }
    }

  private val intervalGroupingFunctions: Map[String, TimeSpan => Interval] = Map(
    "month" -> TimeSpan.groupByMonth,
    "week" -> TimeSpan.groupByWeek,
    "day" -> TimeSpan.groupByDay
  )

  def timeSummedUserList(start: Long,
                         end: Long,
                         annotationTypes: String,
                         teamIds: String,
                         projectIds: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOfOrg(request.identity, request.identity._organization)) ?~> "notAllowed" ~> FORBIDDEN
        teamIdsValidated <- parseObjectIds(teamIds) ?~> "invalidTeamId"
        annotationTypesValidated <- parseAnnotationTypes(annotationTypes) ?~> "invalidAnnotationType"
        _ <- bool2Fox(annotationTypesValidated.nonEmpty) ?~> "annotationTypesEmpty"
        _ <- bool2Fox(annotationTypesValidated.forall(typ =>
          typ == AnnotationType.Explorational || typ == AnnotationType.Task)) ?~> "unsupportedAnnotationType"
        _ <- bool2Fox(teamIdsValidated.nonEmpty) ?~> "teamListEmpty"
        projectIdsValidated <- Fox.runOptional(projectIds)(parseObjectIds)
        users <- userDAO.findAllByTeams(teamIdsValidated)
        notUnlistedUsers = users.filter(!_.isUnlisted)
        usersWithTimesJs <- timeSpanDAO.timeSummedSearch(Instant(start),
                                                         Instant(end),
                                                         notUnlistedUsers.map(_._id),
                                                         annotationTypesValidated,
                                                         projectIdsValidated)
      } yield Ok(Json.toJson(usersWithTimesJs))
    }

  private def parseObjectIds(idsStr: String): Fox[List[ObjectId]] =
    Fox.serialCombined(idsStr.split(",").toList)(id => ObjectId.fromString(id))

  private def parseAnnotationTypes(typesStr: String): Fox[List[AnnotationType]] =
    Fox.serialCombined(typesStr.split(",").toList)(typ => AnnotationType.fromString(typ))
}
