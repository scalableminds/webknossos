package controllers

import com.scalableminds.util.Msg
import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import models.annotation.{AnnotationDAO, AnnotationService, AnnotationType}
import models.organization.OrganizationService
import models.team._
import models.user._
import play.api.libs.json._
import play.api.mvc._
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import models.user.Theme.Theme
import com.scalableminds.util.tools.{Failure, Full}
import play.silhouette.api.exceptions.ProviderException
import play.silhouette.api.util.Credentials
import play.silhouette.impl.providers.CredentialsProvider
import security.WkEnv
import utils.WkConf

import scala.concurrent.ExecutionContext

case class UserUpdateParameters(
    firstName: Option[String],
    lastName: Option[String],
    email: Option[String],
    password: Option[String],
    isActive: Option[Boolean],
    isAdmin: Option[Boolean],
    isDatasetManager: Option[Boolean],
    teams: Option[List[TeamMembership]],
    experiences: Option[Map[String, Int]],
    lastTaskTypeId: Option[ObjectId]
)
object UserUpdateParameters {
  // No format, only reads, because TeamMembership only has async publicWrites.
  implicit val jsonReads: Reads[UserUpdateParameters] = Json.reads[UserUpdateParameters]
}

case class UpdateLastTaskTypeIdParameters(lastTaskTypeId: Option[ObjectId])
object UpdateLastTaskTypeIdParameters {
  implicit val jsonFormat: OFormat[UpdateLastTaskTypeIdParameters] = Json.format[UpdateLastTaskTypeIdParameters]
}

class UserController @Inject() (
    userService: UserService,
    userDAO: UserDAO,
    multiUserDAO: MultiUserDAO,
    credentialsProvider: CredentialsProvider,
    organizationService: OrganizationService,
    annotationDAO: AnnotationDAO,
    annotationService: AnnotationService,
    teamDAO: TeamDAO,
    conf: WkConf,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
     {

  def current: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    log() {
      for {
        userJs <- userService.publicWrites(request.identity, request.identity)
        _ = userDAO.updateLastActivity(request.identity._id)(using GlobalAccessContext)
      } yield Ok(userJs)
    }
  }

  def user(userId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    log() {
      for {
        user <- userDAO.findOne(userId) ?~> Msg.User.notFound(userId) ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> Msg.notAllowed ~> FORBIDDEN
        js <- userService.publicWrites(user, request.identity)
      } yield Ok(js)
    }
  }

  def annotations(
      isFinished: Option[Boolean],
      limit: Option[Int],
      pageNumber: Option[Int] = None,
      includeTotalCount: Option[Boolean] = None
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotations <- annotationDAO.findAllListableExplorationals(
          isFinished,
          Some(request.identity._id),
          filterOwnedOrShared = true,
          limit.getOrElse(annotationService.DefaultAnnotationListLimit),
          pageNumber.getOrElse(0)
        )
        annotationCount: Option[Int] <- Fox.runIf(includeTotalCount.getOrElse(false))(
          annotationDAO.countAllFor(request.identity._id, isFinished, AnnotationType.Explorational)
        )
        jsonList = annotations.map(annotationService.writeCompactInfo)
        _ = userDAO.updateLastActivity(request.identity._id)(using GlobalAccessContext)
      } yield {
        val result = Ok(Json.toJson(jsonList))
        annotationCount match {
          case Some(count) => result.withHeaders("X-Total-Count" -> count.toString)
          case None        => result
        }
      }
    }

  def tasks(
      isFinished: Option[Boolean],
      limit: Option[Int],
      pageNumber: Option[Int] = None,
      includeTotalCount: Option[Boolean] = None
  ): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      annotations <- annotationDAO.findAllFor(
        request.identity._id,
        isFinished,
        AnnotationType.Task,
        limit.getOrElse(annotationService.DefaultAnnotationListLimit),
        pageNumber.getOrElse(0)
      )
      annotationCount <- Fox.runIf(includeTotalCount.getOrElse(false))(
        annotationDAO.countAllFor(request.identity._id, isFinished, AnnotationType.Task)
      )
      jsonList <- Fox.serialCombined(annotations)(a => annotationService.publicWrites(a, Some(request.identity)))
      _ = userDAO.updateLastActivity(request.identity._id)(using GlobalAccessContext)
    } yield {
      val result = Ok(Json.toJson(jsonList))
      annotationCount match {
        case Some(count) => result.withHeaders("X-Total-Count" -> count.toString)
        case None        => result
      }
    }
  }

  def userAnnotations(
      userId: ObjectId,
      isFinished: Option[Boolean],
      limit: Option[Int],
      pageNumber: Option[Int] = None,
      includeTotalCount: Option[Boolean] = None
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        user <- userDAO.findOne(userId) ?~> Msg.User.notFound(userId) ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> Msg.notAllowed ~> FORBIDDEN
        annotations <- annotationDAO.findAllListableExplorationals(
          isFinished,
          Some(userId),
          filterOwnedOrShared = false,
          limit.getOrElse(annotationService.DefaultAnnotationListLimit),
          pageNumber.getOrElse(0)
        )
        annotationCount <- Fox.runIf(includeTotalCount.getOrElse(false))(
          annotationDAO.countAllFor(userId, isFinished, AnnotationType.Explorational)
        )
        jsonList = annotations.map(annotationService.writeCompactInfo)
      } yield {
        val result = Ok(Json.toJson(jsonList))
        annotationCount match {
          case Some(count) => result.withHeaders("X-Total-Count" -> count.toString)
          case None        => result
        }
      }
    }

  def userTasks(
      userId: ObjectId,
      isFinished: Option[Boolean],
      limit: Option[Int],
      pageNumber: Option[Int] = None,
      includeTotalCount: Option[Boolean] = None
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        user <- userDAO.findOne(userId) ?~> Msg.User.notFound(userId) ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> Msg.notAllowed ~> FORBIDDEN
        annotations <- annotationDAO.findAllFor(
          userId,
          isFinished,
          AnnotationType.Task,
          limit.getOrElse(annotationService.DefaultAnnotationListLimit),
          pageNumber.getOrElse(0)
        )
        annotationCount <- Fox.runIf(includeTotalCount.getOrElse(false))(
          annotationDAO.countAllFor(userId, isFinished, AnnotationType.Task)
        )
        jsonList <- Fox.serialCombined(annotations)(a => annotationService.publicWrites(a, Some(request.identity)))
      } yield {
        val result = Ok(Json.toJson(jsonList))
        annotationCount match {
          case Some(count) => result.withHeaders("X-Total-Count" -> count.toString)
          case None        => result
        }
      }
    }

  // List all users the requesting user is allowed to see (themself and users of whom they are admin or team-manager)
  def list(
      // Optional filtering: If true, list only users the requesting user is allowed to administrate,
      // if false, list only datasets the requesting user is not allowed to administrate
      isEditable: Option[Boolean],
      // Optional filtering: If true, list only users who are team manager or admin, if false, list only users who are neither team manager nor admin
      isTeamManagerOrAdmin: Option[Boolean],
      // Optional filtering: If true, list only users who are admin, if false, list only users who are not admin
      isAdmin: Option[Boolean]
  ): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      userCompactInfos <- userDAO.findAllCompactWithFilters(isEditable, isTeamManagerOrAdmin, isAdmin, request.identity)
      js <- Fox.serialCombined(userCompactInfos.sortBy(_.lastName.toLowerCase))(userService.publicWritesCompact)
    } yield Ok(Json.toJson(js))
  }

  private def ensureProperTeamAdministration(user: User, userFullName: String, teams: List[(TeamMembership, Team)]) =
    Fox.combined(teams.map {
      case (TeamMembership(_, true), team) =>
        for {
          _ <- Fox.fromBool(user._organization == team._organization) ?~> Msg.Team
            .adminNotPossibleBy(team.name, userFullName) ~> FORBIDDEN
        } yield ()
      case (_, _) =>
        Fox.successful(())
    })

  private def checkTeamManagerOnlyUpdates(
      user: User,
      experiences: Map[String, Int],
      oldExperiences: Map[String, Int],
      teams: List[TeamMembership],
      oldTeams: List[TeamMembership]
  )(issuingUser: User): Fox[Boolean] =
    if (experiences == oldExperiences && teams == oldTeams)
      Fox.successful(true)
    else userService.isEditableBy(user, issuingUser)

  private def checkPasswordIfEmailChanged(user: User, passwordOpt: Option[String], oldEmail: String, email: String)(
      issuingUser: User
  ): Fox[Unit] =
    if (oldEmail == email) {
      Fox.successful(())
    } else if (user._id == issuingUser._id) {
      passwordOpt match {
        case Some(password) =>
          val credentials = Credentials(user._id.id, password)
          Fox.fromFutureBox(
            credentialsProvider
              .authenticate(credentials)
              .flatMap { loginInfo =>
                userService.retrieve(loginInfo).map {
                  case Some(_) => Full(())
                  case None    => Failure(Msg.User.noUserWithThisEmail)
                }
              }
              .recover { case _: ProviderException =>
                Failure(Msg.User.invalidCredentials)
              }
          )
        case None => Fox.failure(Msg.User.invalidCredentials)
      }
    } else {
      Fox.failure(Msg.notAllowed)
    }

  private def checkEmailDoesNotExistIfChanged(email: String, oldEmail: String)(using ctx: DBAccessContext): Fox[Unit] =
    if (oldEmail == email) {
      Fox.successful(())
    } else {
      multiUserDAO.emailNotPresentYet(email).flatMap {
        case true  => Fox.successful(())
        case false => Fox.failure(Msg.User.Email.taken)
      }
    }

  private def checkAdminOnlyUpdates(user: User, isActive: Boolean, isAdmin: Boolean, isDatasetManager: Boolean)(
      issuingUser: User
  ): Boolean =
    if (isActive && user.isAdmin == isAdmin && isDatasetManager == user.isDatasetManager)
      true
    else issuingUser.isAdminOf(user)

  private def checkNoSelfDeactivate(user: User, isActive: Boolean)(issuingUser: User): Boolean =
    issuingUser._id != user._id || isActive || user.isDeactivated

  private def checkNoActivateBeyondLimit(user: User, isActive: Boolean): Fox[Unit] =
    for {
      _ <- Fox.runIf(user.isDeactivated && isActive)(
        organizationService.assertUsersCanBeAdded(user._organization)(using GlobalAccessContext, ec)
      ) ?~> Msg.Organization.usersUserLimitReached
    } yield ()

  private def checkNoDeactivateWithRemainingTask(user: User, isActive: Boolean): Fox[Unit] =
    if (!isActive && !user.isDeactivated) {
      for {
        activeTasks: List[ObjectId] <- annotationDAO.findActiveTaskIdsForUser(user._id)
        _ <- Fox.fromBool(
          activeTasks.isEmpty
        ) ?~> s"Cannot deactivate user with active tasks. Task ids are: ${activeTasks.mkString(";")}"
      } yield ()
    } else Fox.successful(())

  private def preventZeroAdmins(user: User, isAdmin: Boolean) =
    if (user.isAdmin && !isAdmin) {
      for {
        adminCount <- userDAO.countAdminsForOrganization(user._organization)
        _ <- Fox.fromBool(adminCount > 1) ?~> Msg.User.lastAdmin
      } yield ()
    } else Fox.successful(())

  private def preventZeroOwners(user: User, isActive: Boolean) =
    if (user.isOrganizationOwner && !user.isDeactivated && !isActive) {
      for {
        ownerCount <- userDAO.countOwnersForOrganization(user._organization)
        _ <- Fox.fromBool(ownerCount > 1) ?~> Msg.User.lastOwner
      } yield ()
    } else Fox.successful(())

  def update(userId: ObjectId): Action[UserUpdateParameters] =
    sil.SecuredAction.async(validateJson[UserUpdateParameters]) { implicit request =>
      for {
        user <- userDAO.findOne(userId) ?~> Msg.User.notFound(userId) ~> NOT_FOUND
        multiUser <- multiUserDAO.findOne(user._multiUser)
        // properties that can be changed by team managers and admins only: experiences, team memberships
        oldExperience <- userService.experiencesFor(user._id)
        oldTeamMemberships <- userService.teamMembershipsFor(user._id)
        firstName = request.body.firstName.getOrElse(multiUser.firstName)
        lastName = request.body.lastName.getOrElse(multiUser.lastName)
        oldEmail = multiUser.email
        email = request.body.email.getOrElse(oldEmail)
        isActive = request.body.isActive.getOrElse(!user.isDeactivated)
        isAdmin = request.body.isAdmin.getOrElse(user.isAdmin)
        isDatasetManager = request.body.isDatasetManager.getOrElse(user.isDatasetManager)
        teamMemberships = request.body.teams.getOrElse(oldTeamMemberships)
        experiences = request.body.experiences.getOrElse(oldExperience)
        lastTaskTypeId = request.body.lastTaskTypeId.orElse(user.lastTaskTypeId)
        _ <- Fox.runIf(user._id != request.identity._id)(
          Fox.assertTrue(userService.isEditableBy(user, request.identity))
        ) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- checkTeamManagerOnlyUpdates(user, experiences, oldExperience, teamMemberships, oldTeamMemberships)(
          request.identity
        ) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- Fox.fromBool(
          checkAdminOnlyUpdates(user, isActive, isAdmin, isDatasetManager)(request.identity)
        ) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- checkPasswordIfEmailChanged(user, request.body.password, oldEmail, email)(request.identity)
        _ <- checkEmailDoesNotExistIfChanged(email, oldEmail)
        _ <- Fox.fromBool(
          checkNoSelfDeactivate(user, isActive)(request.identity)
        ) ?~> Msg.User.noSelfDeactivate ~> FORBIDDEN
        _ <- checkNoDeactivateWithRemainingTask(user, isActive)
        _ <- checkNoActivateBeyondLimit(user, isActive)
        _ <- preventZeroAdmins(user, isAdmin)
        _ <- preventZeroOwners(user, isActive)
        _ <- checkNameUpdatePermissions(
          user,
          request.identity,
          multiUser.firstName,
          multiUser.lastName,
          firstName,
          lastName
        )
        teams <- Fox.combined(
          teamMemberships.map(t =>
            teamDAO.findOne(t.teamId)(using GlobalAccessContext) ?~> Msg.Team.notFound(t.teamId) ~> NOT_FOUND
          )
        )
        oldTeamMemberships <- userService.teamMembershipsFor(user._id)
        teamsWithoutUpdate <- Fox.filterNot(oldTeamMemberships)(t =>
          userService.isTeamManagerOrAdminOf(request.identity, t.teamId)
        )
        assignedMembershipWTeams = teamMemberships.zip(teams)
        teamsWithUpdate <- Fox.filter(assignedMembershipWTeams)(t =>
          userService.isTeamManagerOrAdminOf(request.identity, t._1.teamId)
        )
        _ <- ensureProperTeamAdministration(user, multiUser.fullName, teamsWithUpdate)
        trimmedExperiences = experiences.map { case (key, value) => key.trim -> value }
        updatedTeams = teamsWithUpdate.map(_._1) ++ teamsWithoutUpdate
        _ <- userService.update(
          user,
          multiUser,
          firstName.trim,
          lastName.trim,
          email,
          isActive,
          isAdmin,
          isDatasetManager,
          updatedTeams,
          trimmedExperiences,
          lastTaskTypeId
        )
        updatedUser <- userDAO.findOne(userId)
        updatedJs <- userService.publicWrites(updatedUser, request.identity)
      } yield Ok(updatedJs)
    }

  private def checkNameUpdatePermissions(
      originalUser: User,
      issuingUser: User,
      firstNameBefore: String,
      lastNameBefore: String,
      firstName: String,
      lastName: String
  ): Fox[Unit] =
    if (firstName.trim == firstNameBefore && lastName.trim == lastNameBefore)
      Fox.successful(())
    else {
      if (issuingUser._id == originalUser._id)
        Fox.successful(())
      else if (conf.Features.isWkorgInstance) {
        Fox.failure("On this webknossos instance, users may only change their own names.")
      } else {
        if (issuingUser.isAdminOf(originalUser))
          Fox.successful(())
        else
          Fox.failure("Only admins can change the names of other users.")
      }
    }

  def updateLastTaskTypeId(userId: ObjectId): Action[UpdateLastTaskTypeIdParameters] =
    sil.SecuredAction.async(validateJson[UpdateLastTaskTypeIdParameters]) { implicit request =>
      for {
        user <- userDAO.findOne(userId) ?~> Msg.User.notFound(userId) ~> NOT_FOUND
        isEditable <- userService.isEditableBy(user, request.identity) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- Fox.fromBool(isEditable | user._id == request.identity._id)
        _ <- userService.updateLastTaskTypeId(user, request.body.lastTaskTypeId)
        updatedUser <- userDAO.findOne(userId)
        updatedJs <- userService.publicWrites(updatedUser, request.identity)
      } yield Ok(updatedJs)
    }

  def updateNovelUserExperienceInfos(userId: ObjectId): Action[JsObject] =
    sil.SecuredAction.async(validateJson[JsObject]) { implicit request =>
      for {
        _ <- Fox.fromBool(request.identity._id == userId) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- multiUserDAO.updateNovelUserExperienceInfos(request.identity._multiUser, request.body)
        updatedUser <- userDAO.findOne(userId)
        updatedJs <- userService.publicWrites(updatedUser, request.identity)
      } yield Ok(updatedJs)
    }

  def updateSelectedTheme(userId: ObjectId): Action[Theme] =
    sil.SecuredAction.async(validateJson[Theme]) { implicit request =>
      for {
        _ <- Fox.fromBool(request.identity._id == userId) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- multiUserDAO.updateSelectedTheme(request.identity._multiUser, request.body)
        updatedUser <- userDAO.findOne(userId)
        updatedJs <- userService.publicWrites(updatedUser, request.identity)
      } yield Ok(updatedJs)
    }

}
