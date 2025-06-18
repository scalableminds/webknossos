package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationService, AnnotationType}
import models.organization.OrganizationService
import models.team._
import models.user._
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.api.mvc._
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import models.user.Theme.Theme
import net.liftweb.common.{Box, Failure, Full}
import play.silhouette.api.exceptions.ProviderException
import play.silhouette.api.util.Credentials
import play.silhouette.impl.providers.CredentialsProvider
import security.WkEnv

import scala.concurrent.ExecutionContext

class UserController @Inject()(userService: UserService,
                               userDAO: UserDAO,
                               multiUserDAO: MultiUserDAO,
                               credentialsProvider: CredentialsProvider,
                               organizationService: OrganizationService,
                               annotationDAO: AnnotationDAO,
                               teamMembershipService: TeamMembershipService,
                               annotationService: AnnotationService,
                               teamDAO: TeamDAO,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  def current: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    log() {
      for {
        userJs <- userService.publicWrites(request.identity, request.identity)
        _ = userDAO.updateLastActivity(request.identity._id)(GlobalAccessContext)
      } yield Ok(userJs)
    }
  }

  def user(userId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    log() {
      for {
        user <- userDAO.findOne(userId) ?~> "user.notFound" ~> NOT_FOUND
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
        annotations <- annotationDAO.findAllListableExplorationals(
          isFinished,
          Some(request.identity._id),
          filterOwnedOrShared = true,
          limit.getOrElse(annotationService.DefaultAnnotationListLimit),
          pageNumber.getOrElse(0)
        )
        annotationCount: Option[Int] <- Fox.runIf(includeTotalCount.getOrElse(false))(
          annotationDAO.countAllFor(request.identity._id, isFinished, AnnotationType.Explorational))
        jsonList = annotations.map(annotationService.writeCompactInfo)
        _ = userDAO.updateLastActivity(request.identity._id)(GlobalAccessContext)
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
                                                limit.getOrElse(annotationService.DefaultAnnotationListLimit),
                                                pageNumber.getOrElse(0))
        annotationCount <- Fox.runIf(includeTotalCount.getOrElse(false))(
          annotationDAO.countAllFor(request.identity._id, isFinished, AnnotationType.Task))
        jsonList <- Fox.serialCombined(annotations)(a => annotationService.publicWrites(a, Some(request.identity)))
        _ = userDAO.updateLastActivity(request.identity._id)(GlobalAccessContext)
      } yield {
        val result = Ok(Json.toJson(jsonList))
        annotationCount match {
          case Some(count) => result.withHeaders("X-Total-Count" -> count.toString)
          case None        => result
        }
      }
  }

  def userAnnotations(userId: ObjectId,
                      isFinished: Option[Boolean],
                      limit: Option[Int],
                      pageNumber: Option[Int] = None,
                      includeTotalCount: Option[Boolean] = None): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        user <- userDAO.findOne(userId) ?~> "user.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        annotations <- annotationDAO.findAllListableExplorationals(
          isFinished,
          Some(userId),
          filterOwnedOrShared = false,
          limit.getOrElse(annotationService.DefaultAnnotationListLimit),
          pageNumber.getOrElse(0)
        )
        annotationCount <- Fox.runIf(includeTotalCount.getOrElse(false))(
          annotationDAO.countAllFor(userId, isFinished, AnnotationType.Explorational))
        jsonList = annotations.map(annotationService.writeCompactInfo)
      } yield {
        val result = Ok(Json.toJson(jsonList))
        annotationCount match {
          case Some(count) => result.withHeaders("X-Total-Count" -> count.toString)
          case None        => result
        }
      }
    }

  def userTasks(userId: ObjectId,
                isFinished: Option[Boolean],
                limit: Option[Int],
                pageNumber: Option[Int] = None,
                includeTotalCount: Option[Boolean] = None): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        user <- userDAO.findOne(userId) ?~> "user.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        annotations <- annotationDAO.findAllFor(userId,
                                                isFinished,
                                                AnnotationType.Task,
                                                limit.getOrElse(annotationService.DefaultAnnotationListLimit),
                                                pageNumber.getOrElse(0))
        annotationCount <- Fox.runIf(includeTotalCount.getOrElse(false))(
          annotationDAO.countAllFor(userId, isFinished, AnnotationType.Task))
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

  private val userUpdateReader =
    ((__ \ "firstName").readNullable[String] and
      (__ \ "lastName").readNullable[String] and
      (__ \ "email").readNullable[String] and
      (__ \ "password").readNullable[String] and
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
          _ <- Fox.fromBool(team.couldBeAdministratedBy(user)) ?~> Messages("team.admin.notPossibleBy",
                                                                            team.name,
                                                                            user.name) ~> FORBIDDEN
        } yield ()
      case (_, _) =>
        Fox.successful(())
    })

  private def checkTeamManagerOnlyUpdates(user: User,
                                          experiences: Map[String, Int],
                                          oldExperiences: Map[String, Int],
                                          teams: List[TeamMembership],
                                          oldTeams: List[TeamMembership])(issuingUser: User): Fox[Boolean] =
    if (experiences == oldExperiences && teams == oldTeams)
      Fox.successful(true)
    else userService.isEditableBy(user, issuingUser)

  private def checkPasswordIfEmailChanged(user: User, passwordOpt: Option[String], oldEmail: String, email: String)(
      issuingUser: User)(implicit m: MessagesProvider): Fox[Unit] =
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
                  case Some(user) => Full(())
                  case None       => Failure(Messages("error.noUser"))
                }
              }
              .recover {
                case _: ProviderException =>
                  Failure(Messages("error.invalidCredentials"))
              })
        case None => Fox.failure(Messages("error.passwordsDontMatch"))
      }
    } else {
      Fox.failure(Messages("notAllowed"))
    }

  private def checkAdminOnlyUpdates(user: User, isActive: Boolean, isAdmin: Boolean, isDatasetManager: Boolean)(
      issuingUser: User): Boolean =
    if (isActive && user.isAdmin == isAdmin && isDatasetManager == user.isDatasetManager)
      true
    else issuingUser.isAdminOf(user)

  private def checkNoSelfDeactivate(user: User, isActive: Boolean)(issuingUser: User): Boolean =
    issuingUser._id != user._id || isActive || user.isDeactivated

  private def checkNoActivateBeyondLimit(user: User, isActive: Boolean): Fox[Unit] =
    for {
      _ <- Fox.runIf(user.isDeactivated && isActive)(
        organizationService
          .assertUsersCanBeAdded(user._organization)(GlobalAccessContext, ec)) ?~> "organization.users.userLimitReached"
    } yield ()

  private def checkNoDeactivateWithRemainingTask(user: User, isActive: Boolean): Fox[Unit] =
    if (!isActive && !user.isDeactivated) {
      for {
        activeTasks: List[ObjectId] <- annotationDAO.findActiveTaskIdsForUser(user._id)
        _ <- Fox.fromBool(activeTasks.isEmpty) ?~> s"Cannot deactivate user with active tasks. Task ids are: ${activeTasks
          .mkString(";")}"
      } yield ()
    } else Fox.successful(())

  private def checkSuperUserOnlyUpdates(user: User, oldEmail: String, email: String)(issuingUser: User)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    if (oldEmail == email) Fox.successful(())
    else
      for {
        count <- userDAO.countIdentitiesForMultiUser(user._multiUser)
        issuingMultiUser <- multiUserDAO.findOne(issuingUser._multiUser)
        _ <- Fox.fromBool(count <= 1 || issuingMultiUser.isSuperUser) ?~> "user.email.onlySuperUserCanChange"
        // TODOM: @fm3 should we keep this check as now we can have guest users?
      } yield ()

  private def preventZeroAdmins(user: User, isAdmin: Boolean) =
    if (user.isAdmin && !isAdmin) {
      for {
        adminCount <- userDAO.countAdminsForOrganization(user._organization)
        _ <- Fox.fromBool(adminCount > 1) ?~> "user.lastAdmin"
      } yield ()
    } else Fox.successful(())

  private def preventZeroOwners(user: User, isActive: Boolean) =
    if (user.isOrganizationOwner && !user.isDeactivated && !isActive) {
      for {
        ownerCount <- userDAO.countOwnersForOrganization(user._organization)
        _ <- Fox.fromBool(ownerCount > 1) ?~> "user.lastOwner"
      } yield ()
    } else Fox.successful(())

  def update(userId: ObjectId): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    val issuingUser = request.identity
    withJsonBodyUsing(userUpdateReader) {
      case (firstNameOpt,
            lastNameOpt,
            emailOpt,
            passwordOpt,
            isActiveOpt,
            isAdminOpt,
            isDatasetManagerOpt,
            assignedMembershipsOpt,
            experiencesOpt,
            lastTaskTypeIdOpt) =>
        for {
          user <- userDAO.findOne(userId) ?~> "user.notFound" ~> NOT_FOUND
          // properties for team managers dataset manager and admins only: experiences, teams
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
          _ <- Fox
            .runIf(user._id != issuingUser._id)(Fox.assertTrue(userService.isEditableBy(user, request.identity))) ?~> "notAllowed" ~> FORBIDDEN
          _ <- checkTeamManagerOnlyUpdates(user,
                                           experiences,
                                           oldExperience,
                                           assignedMemberships,
                                           oldAssignedMemberships)(issuingUser) ?~> "notAllowed" ~> FORBIDDEN
          _ <- Fox
            .fromBool(checkAdminOnlyUpdates(user, isActive, isAdmin, isDatasetManager)(issuingUser)) ?~> "notAllowed" ~> FORBIDDEN
          _ <- checkPasswordIfEmailChanged(user, passwordOpt, oldEmail, email)(issuingUser)
          _ <- Fox.fromBool(checkNoSelfDeactivate(user, isActive)(issuingUser)) ?~> "user.noSelfDeactivate" ~> FORBIDDEN
          _ <- checkNoDeactivateWithRemainingTask(user, isActive)
          _ <- checkNoActivateBeyondLimit(user, isActive)
          _ <- checkSuperUserOnlyUpdates(user, oldEmail, email)(issuingUser)
          _ <- preventZeroAdmins(user, isAdmin)
          _ <- preventZeroOwners(user, isActive)
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
          updatedUser <- userDAO.findOne(userId)
          updatedJs <- userService.publicWrites(updatedUser, request.identity)
        } yield Ok(updatedJs)
    }
  }

  def updateLastTaskTypeId(userId: ObjectId): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      val issuingUser = request.identity
      withJsonBodyUsing((__ \ "lastTaskTypeId").readNullable[String]) { lastTaskTypeId =>
        for {
          user <- userDAO.findOne(userId) ?~> "user.notFound" ~> NOT_FOUND
          isEditable <- userService.isEditableBy(user, request.identity) ?~> "notAllowed" ~> FORBIDDEN
          _ <- Fox.fromBool(isEditable | user._id == issuingUser._id)
          _ <- userService.updateLastTaskTypeId(user, lastTaskTypeId)
          updatedUser <- userDAO.findOne(userId)
          updatedJs <- userService.publicWrites(updatedUser, request.identity)
        } yield Ok(updatedJs)
      }
  }

  def updateNovelUserExperienceInfos(userId: ObjectId): Action[JsObject] =
    sil.SecuredAction.async(validateJson[JsObject]) { implicit request =>
      for {
        _ <- Fox.fromBool(request.identity._id == userId) ?~> "notAllowed" ~> FORBIDDEN
        _ <- multiUserDAO.updateNovelUserExperienceInfos(request.identity._multiUser, request.body)
        updatedUser <- userDAO.findOne(userId)
        updatedJs <- userService.publicWrites(updatedUser, request.identity)
      } yield Ok(updatedJs)
    }

  def updateSelectedTheme(userId: ObjectId): Action[Theme] =
    sil.SecuredAction.async(validateJson[Theme]) { implicit request =>
      for {
        _ <- Fox.fromBool(request.identity._id == userId) ?~> "notAllowed" ~> FORBIDDEN
        _ <- multiUserDAO.updateSelectedTheme(request.identity._multiUser, request.body)
        updatedUser <- userDAO.findOne(userId)
        updatedJs <- userService.publicWrites(updatedUser, request.identity)
      } yield Ok(updatedJs)
    }

}
