package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.mvc.Filter
import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import io.swagger.annotations.{Api, ApiOperation, ApiResponse, ApiResponses}
import models.annotation.{AnnotationDAO, AnnotationService, AnnotationType}
import models.team._
import models.user._
import models.user.time._
import oxalis.security.WkEnv
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.functional.syntax._
import play.api.libs.json.Json._
import play.api.libs.json._
import play.api.mvc._
import utils.ObjectId
import javax.inject.Inject
import models.user.Theme.Theme

import scala.concurrent.ExecutionContext

@Api
class UserController @Inject()(userService: UserService,
                               userDAO: UserDAO,
                               multiUserDAO: MultiUserDAO,
                               annotationDAO: AnnotationDAO,
                               timeSpanService: TimeSpanService,
                               teamMembershipService: TeamMembershipService,
                               annotationService: AnnotationService,
                               teamDAO: TeamDAO,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  private val DefaultAnnotationListLimit = 1000

  def current: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    log() {
      for {
        userJs <- userService.publicWrites(request.identity, request.identity)
      } yield Ok(userJs)
    }
  }

  def user(userId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    log() {
      for {
        userIdValidated <- ObjectId.parse(userId) ?~> "user.id.invalid"
        user <- userDAO.findOne(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        js <- userService.publicWrites(user, request.identity)
      } yield Ok(js)
    }
  }

  def annotations(isFinished: Option[Boolean],
                  limit: Option[Int],
                  pageNumber: Option[Int] = None,
                  includeTotalCount: Option[Boolean] = None): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotations <- annotationDAO.findAllFor(request.identity._id,
                                                isFinished,
                                                AnnotationType.Explorational,
                                                limit.getOrElse(DefaultAnnotationListLimit),
                                                pageNumber.getOrElse(0))
        annotationCount <- Fox.runOptional(includeTotalCount.flatMap(BoolToOption.convert))(_ =>
          annotationDAO.countAllFor(request.identity._id, isFinished, AnnotationType.Explorational))
        jsonList <- Fox.serialCombined(annotations)(a => annotationService.compactWrites(a))
      } yield {
        val result = Ok(Json.toJson(jsonList))
        annotationCount match {
          case Some(count) => result.withHeaders("X-Total-Count" -> count.toString)
          case None        => result
        }
      }
    }

  def tasks(isFinished: Option[Boolean],
            limit: Option[Int],
            pageNumber: Option[Int] = None,
            includeTotalCount: Option[Boolean] = None): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        annotations <- annotationDAO.findAllFor(request.identity._id,
                                                isFinished,
                                                AnnotationType.Task,
                                                limit.getOrElse(DefaultAnnotationListLimit),
                                                pageNumber.getOrElse(0))
        annotationCount <- Fox.runOptional(includeTotalCount.flatMap(BoolToOption.convert))(_ =>
          annotationDAO.countAllFor(request.identity._id, isFinished, AnnotationType.Task))
        jsonList <- Fox.serialCombined(annotations)(a => annotationService.publicWrites(a, Some(request.identity)))
      } yield {
        val result = Ok(Json.toJson(jsonList))
        annotationCount match {
          case Some(count) => result.withHeaders("X-Total-Count" -> count.toString)
          case None        => result
        }
      }
  }

  def userLoggedTime(userId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      userIdValidated <- ObjectId.parse(userId) ?~> "user.id.invalid"
      user <- userDAO.findOne(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> "notAllowed" ~> FORBIDDEN
      loggedTimeAsMap <- timeSpanService.loggedTimeOfUser(user, TimeSpan.groupByMonth)
    } yield {
      JsonOk(
        Json.obj("loggedTime" ->
          loggedTimeAsMap.map {
            case (paymentInterval, duration) =>
              Json.obj("paymentInterval" -> paymentInterval, "durationInSeconds" -> duration.toSeconds)
          }))
    }
  }

  private def groupByAnnotationAndDay(timeSpan: TimeSpan) =
    (timeSpan._annotation.map(_.toString).getOrElse("<none>"), TimeSpan.groupByDay(timeSpan))

  def usersLoggedTime: Action[TimeSpanRequest] = sil.SecuredAction.async(validateJson[TimeSpanRequest]) {
    implicit request =>
      Fox
        .combined(request.body.users.map { userId =>
          for {
            userIdValidated <- ObjectId.parse(userId) ?~> "user.id.invalid"
            user <- userDAO.findOne(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
            userEmail <- userService.emailFor(user)
            _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> "notAllowed" ~> FORBIDDEN
            result <- timeSpanService.loggedTimeOfUser(user,
                                                       groupByAnnotationAndDay,
                                                       Some(request.body.start),
                                                       Some(request.body.end))
          } yield {
            Json.obj(
              "user" -> Json.obj(
                "userId" -> user._id.toString,
                "firstName" -> user.firstName,
                "lastName" -> user.lastName,
                "email" -> userEmail
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
        })
        .map(loggedTime => Ok(Json.toJson(loggedTime)))
  }

  def userAnnotations(userId: String,
                      isFinished: Option[Boolean],
                      limit: Option[Int],
                      pageNumber: Option[Int] = None,
                      includeTotalCount: Option[Boolean] = None): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        userIdValidated <- ObjectId.parse(userId) ?~> "user.id.invalid"
        user <- userDAO.findOne(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        annotations <- annotationDAO.findAllFor(userIdValidated,
                                                isFinished,
                                                AnnotationType.Explorational,
                                                limit.getOrElse(DefaultAnnotationListLimit),
                                                pageNumber.getOrElse(0))
        annotationCount <- Fox.runOptional(includeTotalCount.flatMap(BoolToOption.convert))(_ =>
          annotationDAO.countAllFor(userIdValidated, isFinished, AnnotationType.Explorational))
        jsonList <- Fox.serialCombined(annotations)(a => annotationService.compactWrites(a))
      } yield {
        val result = Ok(Json.toJson(jsonList))
        annotationCount match {
          case Some(count) => result.withHeaders("X-Total-Count" -> count.toString)
          case None        => result
        }
      }
    }

  def userTasks(userId: String,
                isFinished: Option[Boolean],
                limit: Option[Int],
                pageNumber: Option[Int] = None,
                includeTotalCount: Option[Boolean] = None): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        userIdValidated <- ObjectId.parse(userId) ?~> "user.id.invalid"
        user <- userDAO.findOne(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        annotations <- annotationDAO.findAllFor(userIdValidated,
                                                isFinished,
                                                AnnotationType.Task,
                                                limit.getOrElse(DefaultAnnotationListLimit),
                                                pageNumber.getOrElse(0))
        annotationCount <- Fox.runOptional(includeTotalCount.flatMap(BoolToOption.convert))(_ =>
          annotationDAO.countAllFor(userIdValidated, isFinished, AnnotationType.Task))
        jsonList <- Fox.serialCombined(annotations)(a => annotationService.publicWrites(a, Some(request.identity)))
      } yield {
        val result = Ok(Json.toJson(jsonList))
        annotationCount match {
          case Some(count) => result.withHeaders("X-Total-Count" -> count.toString)
          case None        => result
        }
      }
    }

  def loggedTime: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      loggedTimeAsMap <- timeSpanService.loggedTimeOfUser(request.identity, TimeSpan.groupByMonth)
    } yield {
      JsonOk(
        Json.obj("loggedTime" ->
          loggedTimeAsMap.map {
            case (paymentInterval, duration) =>
              Json.obj("paymentInterval" -> paymentInterval, "durationInSeconds" -> duration.toSeconds)
          }))
    }
  }

  @ApiOperation(value = "List all users for which you have read access")
  @ApiResponses(Array(
    new ApiResponse(code = 200, message = "JSON list of objects containing user information, including team memberships and experiences"),
    new ApiResponse(code = 400, message = "Operation could not be performed. See JSON body for more information.")))
  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    UsingFilters(
      Filter("isEditable",
             (value: Boolean, el: User) =>
               for { isEditable <- userService.isEditableBy(el, request.identity) } yield isEditable == value),
      Filter(
        "isTeamManagerOrAdmin",
        (value: Boolean, el: User) =>
          for { isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(el, request.identity._organization) } yield
            isTeamManagerOrAdmin == value
      ),
      Filter("isAdmin", (value: Boolean, el: User) => Fox.successful(el.isAdmin == value))
    ) { filter =>
      for {
        users <- userDAO.findAll
        filtered <- filter.applyOn(users)
        js <- Fox.serialCombined(filtered.sortBy(_.lastName.toLowerCase))(u =>
          userService.publicWrites(u, request.identity))
      } yield {
        Ok(Json.toJson(js))
      }
    }
  }

  private val userUpdateReader =
    ((__ \ "firstName").readNullable[String] and
      (__ \ "lastName").readNullable[String] and
      (__ \ "email").readNullable[String] and
      (__ \ "isActive").readNullable[Boolean] and
      (__ \ "isAdmin").readNullable[Boolean] and
      (__ \ "isDatasetManager").readNullable[Boolean] and
      (__ \ "teams").readNullable[List[TeamMembership]](Reads.list(teamMembershipService.publicReads())) and
      (__ \ "experiences").readNullable[Map[String, Int]] and
      (__ \ "lastTaskTypeId").readNullable[String]).tupled

  private def ensureProperTeamAdministration(user: User, teams: List[(TeamMembership, Team)])(
      implicit m: MessagesProvider) =
    Fox.combined(teams.map {
      case (TeamMembership(_, true), team) =>
        for {
          _ <- bool2Fox(team.couldBeAdministratedBy(user)) ?~> Messages("team.admin.notPossibleBy",
                                                                        team.name,
                                                                        user.name) ~> FORBIDDEN
        } yield ()
      case (_, _) =>
        Fox.successful(())
    })

  private def checkAdminOnlyUpdates(user: User,
                                    isActive: Boolean,
                                    isAdmin: Boolean,
                                    isDatasetManager: Boolean,
                                    oldEmail: String,
                                    email: String)(issuingUser: User): Boolean =
    if (isActive && user.isAdmin == isAdmin && oldEmail == email && isDatasetManager == user.isDatasetManager)
      true
    else issuingUser.isAdminOf(user)

  private def checkNoSelfDeactivate(user: User, isActive: Boolean)(issuingUser: User): Boolean =
    issuingUser._id != user._id || isActive || user.isDeactivated

  private def checkSuperUserOnlyUpdates(user: User, oldEmail: String, email: String)(issuingUser: User)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    if (oldEmail == email) Fox.successful(())
    else
      for {
        count <- userDAO.countIdentitiesForMultiUser(user._multiUser)
        issuingMultiUser <- multiUserDAO.findOne(issuingUser._multiUser)
        _ <- bool2Fox(count <= 1 || issuingMultiUser.isSuperUser) ?~> "user.email.onlySuperUserCanChange"
      } yield ()

  private def preventZeroAdmins(user: User, isAdmin: Boolean) =
    if (user.isAdmin && !isAdmin) {
      for {
        adminCount <- userDAO.countAdminsForOrganization(user._organization)
        _ <- bool2Fox(adminCount > 1) ?~> "user.lastAdmin"
      } yield ()
    } else {
      Fox.successful(())
    }

  def update(userId: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    val issuingUser = request.identity
    withJsonBodyUsing(userUpdateReader) {
      case (firstNameOpt,
            lastNameOpt,
            emailOpt,
            isActiveOpt,
            isAdminOpt,
            isDatasetManagerOpt,
            assignedMembershipsOpt,
            experiencesOpt,
            lastTaskTypeIdOpt) =>
        for {
          userIdValidated <- ObjectId.parse(userId) ?~> "user.id.invalid"
          user <- userDAO.findOne(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
          oldExperience <- userService.experiencesFor(user._id)
          oldAssignedMemberships <- userService.teamMembershipsFor(user._id)
          firstName = firstNameOpt.getOrElse(user.firstName)
          lastName = lastNameOpt.getOrElse(user.lastName)
          oldEmail <- userService.emailFor(user)
          email = emailOpt.getOrElse(oldEmail)
          isActive = isActiveOpt.getOrElse(!user.isDeactivated)
          isAdmin = isAdminOpt.getOrElse(user.isAdmin)
          isDatasetManager = isDatasetManagerOpt.getOrElse(user.isDatasetManager)
          assignedMemberships = assignedMembershipsOpt.getOrElse(oldAssignedMemberships)
          experiences = experiencesOpt.getOrElse(oldExperience)
          lastTaskTypeId = if (lastTaskTypeIdOpt.isEmpty) user.lastTaskTypeId.map(_.id) else lastTaskTypeIdOpt
          _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> "notAllowed" ~> FORBIDDEN
          _ <- bool2Fox(checkAdminOnlyUpdates(user, isActive, isAdmin, isDatasetManager, oldEmail, email)(issuingUser)) ?~> "notAllowed" ~> FORBIDDEN
          _ <- bool2Fox(checkNoSelfDeactivate(user, isActive)(issuingUser)) ?~> "user.noSelfDeactivate" ~> FORBIDDEN
          _ <- checkSuperUserOnlyUpdates(user, oldEmail, email)(issuingUser)
          _ <- preventZeroAdmins(user, isAdmin)
          teams <- Fox.combined(assignedMemberships.map(t =>
            teamDAO.findOne(t.teamId)(GlobalAccessContext) ?~> "team.notFound" ~> NOT_FOUND))
          oldTeamMemberships <- userService.teamMembershipsFor(user._id)
          teamsWithoutUpdate <- Fox.filterNot(oldTeamMemberships)(t =>
            userService.isTeamManagerOrAdminOf(issuingUser, t.teamId))
          assignedMembershipWTeams = assignedMemberships.zip(teams)
          teamsWithUpdate <- Fox.filter(assignedMembershipWTeams)(t =>
            userService.isTeamManagerOrAdminOf(issuingUser, t._1.teamId))
          _ <- ensureProperTeamAdministration(user, teamsWithUpdate)
          trimmedExperiences = experiences.map { case (key, value) => key.trim -> value }
          updatedTeams = teamsWithUpdate.map(_._1) ++ teamsWithoutUpdate
          _ <- userService.update(user,
                                  firstName.trim,
                                  lastName.trim,
                                  email,
                                  isActive,
                                  isAdmin,
                                  isDatasetManager,
                                  updatedTeams,
                                  trimmedExperiences,
                                  lastTaskTypeId)
          updatedUser <- userDAO.findOne(userIdValidated)
          updatedJs <- userService.publicWrites(updatedUser, request.identity)
        } yield Ok(updatedJs)
    }
  }

  def updateLastTaskTypeId(userId: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    val issuingUser = request.identity
    withJsonBodyUsing((__ \ "lastTaskTypeId").readNullable[String]) { lastTaskTypeId =>
      for {
        userIdValidated <- ObjectId.parse(userId) ?~> "user.id.invalid"
        user <- userDAO.findOne(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        isEditable <- userService.isEditableBy(user, request.identity) ?~> "notAllowed" ~> FORBIDDEN
        _ <- bool2Fox(isEditable | user._id == issuingUser._id)
        _ <- userService.updateLastTaskTypeId(user, lastTaskTypeId)
        updatedUser <- userDAO.findOne(userIdValidated)
        updatedJs <- userService.publicWrites(updatedUser, request.identity)
      } yield Ok(updatedJs)
    }
  }

  def updateNovelUserExperienceInfos(userId: String): Action[JsObject] =
    sil.SecuredAction.async(validateJson[JsObject]) { implicit request =>
      for {
        userIdValidated <- ObjectId.parse(userId) ?~> "user.id.invalid"
        _ <- bool2Fox(request.identity._id == userIdValidated) ?~> "notAllowed" ~> FORBIDDEN
        _ <- multiUserDAO.updateNovelUserExperienceInfos(request.identity._multiUser, request.body)
        updatedUser <- userDAO.findOne(userIdValidated)
        updatedJs <- userService.publicWrites(updatedUser, request.identity)
      } yield Ok(updatedJs)
    }

  def updateSelectedTheme(userId: String): Action[Theme] =
    sil.SecuredAction.async(validateJson[Theme]) { implicit request =>
      for {
        userIdValidated <- ObjectId.parse(userId) ?~> "user.id.invalid"
        _ <- bool2Fox(request.identity._id == userIdValidated) ?~> "notAllowed" ~> FORBIDDEN
        _ <- multiUserDAO.updateSelectedTheme(request.identity._multiUser, request.body)
        updatedUser <- userDAO.findOne(userIdValidated)
        updatedJs <- userService.publicWrites(updatedUser, request.identity)
      } yield Ok(updatedJs)
    }

}
