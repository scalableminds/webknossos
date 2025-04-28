package models.user

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.typesafe.scalalogging.LazyLogging
import mail.{DefaultMails, Send}
import models.dataset.DatasetDAO
import models.organization.OrganizationDAO
import models.team._
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Full}
import org.apache.pekko.actor.ActorSystem
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json._
import play.silhouette.api.LoginInfo
import play.silhouette.api.services.IdentityService
import play.silhouette.api.util.PasswordInfo
import play.silhouette.impl.providers.CredentialsProvider
import security.{PasswordHasher, TokenDAO}
import utils.sql.SqlEscaping
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

class UserService @Inject()(conf: WkConf,
                            userDAO: UserDAO,
                            multiUserDAO: MultiUserDAO,
                            userExperiencesDAO: UserExperiencesDAO,
                            userDatasetConfigurationDAO: UserDatasetConfigurationDAO,
                            userDatasetLayerConfigurationDAO: UserDatasetLayerConfigurationDAO,
                            organizationDAO: OrganizationDAO,
                            teamDAO: TeamDAO,
                            teamMembershipService: TeamMembershipService,
                            datasetDAO: DatasetDAO,
                            tokenDAO: TokenDAO,
                            emailVerificationService: EmailVerificationService,
                            defaultMails: DefaultMails,
                            passwordHasher: PasswordHasher,
                            actorSystem: ActorSystem)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with SqlEscaping
    with IdentityService[User] {

  private lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  private val userCache: AlfuCache[(ObjectId, String), User] =
    AlfuCache(timeToLive = conf.WebKnossos.Cache.User.timeout, timeToIdle = conf.WebKnossos.Cache.User.timeout)

  def userFromMultiUserEmail(email: String)(implicit ctx: DBAccessContext): Fox[User] =
    for {
      multiUser <- multiUserDAO.findOneByEmail(email)(GlobalAccessContext)
      user <- disambiguateUserFromMultiUser(multiUser)
    } yield user

  private def disambiguateUserFromMultiUser(multiUser: MultiUser)(implicit ctx: DBAccessContext): Fox[User] =
    multiUser._lastLoggedInIdentity match {
      case Some(userId) =>
        for {
          lastLoggedInIdentityBox <- userDAO.findOne(userId).shiftBox
          identity <- lastLoggedInIdentityBox match {
            case Full(user) if !user.isDeactivated => Fox.successful(user)
            case _                                 => userDAO.findFirstByMultiUser(multiUser._id)
          }
        } yield identity
      case None => userDAO.findFirstByMultiUser(multiUser._id)
    }

  def assertNotInOrgaYet(multiUserId: ObjectId, organizationId: String): Fox[Unit] =
    for {
      userBox <- userDAO.findOneByOrgaAndMultiUser(organizationId, multiUserId)(GlobalAccessContext).shiftBox
      _ <- Fox.fromBool(userBox.isEmpty) ?~> "organization.alreadyJoined"
    } yield ()

  def assertIsSuperUser(user: User)(implicit ctx: DBAccessContext): Fox[Unit] =
    assertIsSuperUser(user._multiUser)

  def assertIsSuperUser(multiUserId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    Fox.assertTrue(multiUserDAO.findOne(multiUserId).map(_.isSuperUser))

  def findOneCached(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[User] =
    userCache.getOrLoad((userId, ctx.toStringAnonymous), _ => userDAO.findOne(userId))

  def insert(organizationId: String,
             email: String,
             firstName: String,
             lastName: String,
             isActive: Boolean,
             passwordInfo: PasswordInfo,
             isAdmin: Boolean,
             isOrganizationOwner: Boolean,
             isEmailVerified: Boolean): Fox[User] = {
    implicit val ctx: GlobalAccessContext.type = GlobalAccessContext
    for {
      _ <- Fox.assertTrue(multiUserDAO.emailNotPresentYet(email)(GlobalAccessContext)) ?~> "user.email.alreadyInUse"
      multiUserId = ObjectId.generate
      multiUser = MultiUser(
        multiUserId,
        email,
        passwordInfo,
        isSuperUser = false,
        isEmailVerified = isEmailVerified
      )
      _ <- multiUserDAO.insertOne(multiUser)
      organizationTeamId <- organizationDAO.findOrganizationTeamId(organizationId)
      teamMemberships = List(TeamMembership(organizationTeamId, isTeamManager = false))
      newUserId = ObjectId.generate
      user = User(
        newUserId,
        multiUserId,
        organizationId,
        firstName,
        lastName,
        Instant.now,
        Json.obj(),
        LoginInfo(CredentialsProvider.ID, newUserId.id),
        isAdmin,
        isOrganizationOwner,
        isDatasetManager = false,
        isDeactivated = !isActive,
        isUnlisted = false,
        lastTaskTypeId = None
      )
      _ <- Fox.runIf(!isEmailVerified)(emailVerificationService.sendEmailVerification(user))
      _ <- userDAO.insertOne(user)
      _ <- Fox.combined(teamMemberships.map(userDAO.insertTeamMembership(user._id, _)))
    } yield user
  }

  def fillSuperUserIdentity(originalUser: User, organizationId: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      multiUser <- multiUserDAO.findOne(originalUser._multiUser)
      existingIdentity: Box[User] <- userDAO
        .findOneByOrgaAndMultiUser(organizationId, originalUser._multiUser)(GlobalAccessContext)
        .shiftBox
      _ <- if (multiUser.isSuperUser && existingIdentity.isEmpty) {
        joinOrganization(originalUser, organizationId, autoActivate = true, isAdmin = true, isUnlisted = true)
      } else Fox.successful(())
    } yield ()

  def joinOrganization(originalUser: User,
                       organizationId: String,
                       autoActivate: Boolean,
                       isAdmin: Boolean,
                       isUnlisted: Boolean = false,
                       isOrganizationOwner: Boolean = false): Fox[User] =
    for {
      newUserId <- Fox.successful(ObjectId.generate)
      organizationTeamId <- organizationDAO.findOrganizationTeamId(organizationId)
      organizationTeamMembership = TeamMembership(organizationTeamId, isTeamManager = false)
      loginInfo = LoginInfo(CredentialsProvider.ID, newUserId.id)
      user = originalUser.copy(
        _id = newUserId,
        _organization = organizationId,
        loginInfo = loginInfo,
        lastActivity = Instant.now,
        isAdmin = isAdmin,
        isDatasetManager = false,
        isDeactivated = !autoActivate,
        lastTaskTypeId = None,
        isOrganizationOwner = isOrganizationOwner,
        isUnlisted = isUnlisted,
        created = Instant.now
      )
      _ <- userDAO.insertOne(user)
      _ <- userDAO.insertTeamMembership(user._id, organizationTeamMembership)(GlobalAccessContext)
      _ = logger.info(
        s"Multiuser ${originalUser._multiUser} joined organization $organizationId with new user id $newUserId.")
    } yield user

  def emailFor(user: User)(implicit ctx: DBAccessContext): Fox[String] =
    for {
      multiUser <- multiUserDAO.findOne(user._multiUser)
    } yield multiUser.email

  def update(user: User,
             firstName: String,
             lastName: String,
             email: String,
             activated: Boolean,
             isAdmin: Boolean,
             isDatasetManager: Boolean,
             teamMemberships: List[TeamMembership],
             experiences: Map[String, Int],
             lastTaskTypeId: Option[String])(implicit ctx: DBAccessContext): Fox[User] = {

    if (user.isDeactivated && activated) {
      logger.info(s"Activating user ${user._id}. Access context: ${ctx.toStringAnonymous}")
      Mailer ! Send(defaultMails.activatedMail(user.name, email))
    }
    for {
      oldEmail <- emailFor(user)
      _ <- Fox.runIf(oldEmail != email)(multiUserDAO.updateEmail(user._multiUser, email))
      _ <- userDAO.updateValues(user._id,
                                firstName,
                                lastName,
                                isAdmin,
                                isDatasetManager,
                                isDeactivated = !activated,
                                lastTaskTypeId)
      _ <- userDAO.updateTeamMembershipsForUser(user._id, teamMemberships)
      _ <- userExperiencesDAO.updateExperiencesForUser(user, experiences)
      _ = removeUserFromCache(user._id)
      _ <- if (oldEmail == email) Fox.successful(()) else tokenDAO.updateEmail(oldEmail, email)
      updated <- userDAO.findOne(user._id)
    } yield updated
  }

  private def removeUserFromCache(userId: ObjectId): Unit =
    userCache.clear(idAndAccessContextString => idAndAccessContextString._1 == userId)

  def getPasswordInfo(passwordOpt: Option[String]): PasswordInfo =
    passwordOpt.map(passwordHasher.hash).getOrElse(getOpenIdConnectPasswordInfo)

  def changePasswordInfo(loginInfo: LoginInfo, passwordInfo: PasswordInfo): Fox[PasswordInfo] =
    for {
      userIdValidated <- ObjectId.fromString(loginInfo.providerKey)
      user <- findOneCached(userIdValidated)(GlobalAccessContext)
      _ <- multiUserDAO.updatePasswordInfo(user._multiUser, passwordInfo)(GlobalAccessContext)
    } yield passwordInfo

  private def getOpenIdConnectPasswordInfo: PasswordInfo =
    PasswordInfo("Empty", "")

  def updateUserConfiguration(user: User, configuration: JsObject)(implicit ctx: DBAccessContext): Fox[Unit] =
    userDAO.updateUserConfiguration(user._id, configuration).map { result =>
      removeUserFromCache(user._id)
      result
    }

  def updateDatasetViewConfiguration(
      user: User,
      datasetId: ObjectId,
      datasetConfiguration: DatasetViewConfiguration,
      layerConfiguration: Option[JsValue])(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[Unit] =
    for {
      dataset <- datasetDAO.findOne(datasetId)(GlobalAccessContext) ?~> Messages("dataset.notFound", datasetId)
      layerMap = layerConfiguration.flatMap(_.asOpt[Map[String, JsValue]]).getOrElse(Map.empty)
      _ <- Fox.serialCombined(layerMap.toList) {
        case (name, config) =>
          config.asOpt[LayerViewConfiguration] match {
            case Some(viewConfiguration) =>
              userDatasetLayerConfigurationDAO.updateDatasetConfigurationForUserAndDatasetAndLayer(user._id,
                                                                                                   dataset._id,
                                                                                                   name,
                                                                                                   viewConfiguration)
            case None => Fox.successful(())
          }
      }
      _ <- userDatasetConfigurationDAO.updateDatasetConfigurationForUserAndDataset(user._id,
                                                                                   dataset._id,
                                                                                   datasetConfiguration)
    } yield ()

  def updateLastTaskTypeId(user: User, lastTaskTypeId: Option[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    userDAO.updateLastTaskTypeId(user._id, lastTaskTypeId).map { result =>
      removeUserFromCache(user._id)
      result
    }

  def retrieve(loginInfo: LoginInfo): Future[Option[User]] =
    findOneCached(ObjectId(loginInfo.providerKey))(GlobalAccessContext).futureBox.map(_.toOption)

  def createLoginInfo(userId: ObjectId): LoginInfo =
    LoginInfo(CredentialsProvider.ID, userId.id)

  def createPasswordInfo(pw: String): PasswordInfo =
    PasswordInfo("SCrypt", SCrypt.hashPassword(pw))

  def experiencesFor(_user: ObjectId): Fox[Map[String, Int]] =
    userExperiencesDAO.findAllExperiencesForUser(_user)

  def teamMembershipsFor(_user: ObjectId): Fox[List[TeamMembership]] =
    userDAO.findTeamMembershipsForUser(_user) ?~> "user.team.memberships.failed"

  def teamManagerMembershipsFor(_user: ObjectId): Fox[List[TeamMembership]] =
    for {
      teamMemberships <- teamMembershipsFor(_user) ?~> "user.team.memberships.failed"
    } yield teamMemberships.filter(_.isTeamManager)

  def teamManagerTeamIdsFor(_user: ObjectId): Fox[List[ObjectId]] =
    for {
      teamManagerMemberships <- teamManagerMembershipsFor(_user)
    } yield teamManagerMemberships.map(_.teamId)

  def teamIdsFor(_user: ObjectId): Fox[List[ObjectId]] =
    for {
      teamMemberships <- teamMembershipsFor(_user)
    } yield teamMemberships.map(_.teamId)

  def isTeamManagerOrAdminOf(possibleAdmin: User, otherUser: User): Fox[Boolean] =
    for {
      otherUserTeamIds <- teamIdsFor(otherUser._id)
      teamManagerTeamIds <- teamManagerTeamIdsFor(possibleAdmin._id)
    } yield otherUserTeamIds.intersect(teamManagerTeamIds).nonEmpty || possibleAdmin.isAdminOf(otherUser)

  def isTeamManagerOrAdminOf(user: User, _team: ObjectId): Fox[Boolean] =
    (for {
      team <- teamDAO.findOne(_team)(GlobalAccessContext)
      teamManagerTeamIds <- teamManagerTeamIdsFor(user._id)
    } yield teamManagerTeamIds.contains(_team) || user.isAdminOf(team._organization)) ?~> "team.admin.notAllowed"

  private def isTeamManagerInOrg(user: User,
                                 organizationId: String,
                                 teamManagerMemberships: Option[List[TeamMembership]] = None): Fox[Boolean] =
    for {
      teamManagerMemberships <- Fox.fillOption(teamManagerMemberships)(teamManagerMembershipsFor(user._id))
    } yield teamManagerMemberships.nonEmpty && organizationId == user._organization

  def isTeamManagerOrAdminOfOrg(user: User, organizationId: String): Fox[Boolean] =
    for {
      isTeamManager <- isTeamManagerInOrg(user, organizationId)
    } yield isTeamManager || user.isAdminOf(organizationId)

  def isEditableBy(possibleEditee: User, possibleEditor: User): Fox[Boolean] =
    // Note that the same logic is implemented in User/findAllCompactWithFilters in SQL
    for {
      otherIsTeamManagerOrAdmin <- isTeamManagerOrAdminOf(possibleEditor, possibleEditee)
      teamMemberships <- teamMembershipsFor(possibleEditee._id)
    } yield otherIsTeamManagerOrAdmin || teamMemberships.isEmpty

  def publicWrites(user: User, requestingUser: User): Fox[JsObject] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      isEditable <- isEditableBy(user, requestingUser)
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext)
      teamMemberships <- teamMembershipsFor(user._id)
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      novelUserExperienceInfos = multiUser.novelUserExperienceInfos
      teamMembershipsJs <- Fox.serialCombined(teamMemberships)(tm => teamMembershipService.publicWrites(tm))
      experiences <- experiencesFor(user._id)
    } yield {
      Json.obj(
        "id" -> user._id.toString,
        "email" -> multiUser.email,
        "firstName" -> user.firstName,
        "lastName" -> user.lastName,
        "isAdmin" -> user.isAdmin,
        "isOrganizationOwner" -> user.isOrganizationOwner,
        "isDatasetManager" -> user.isDatasetManager,
        "isActive" -> !user.isDeactivated,
        "teams" -> teamMembershipsJs,
        "experiences" -> experiences,
        "lastActivity" -> user.lastActivity,
        "isAnonymous" -> false,
        "isEditable" -> isEditable,
        "organization" -> organization._id,
        "novelUserExperienceInfos" -> novelUserExperienceInfos,
        "selectedTheme" -> multiUser.selectedTheme,
        "created" -> user.created,
        "lastTaskTypeId" -> user.lastTaskTypeId.map(_.toString),
        "isSuperUser" -> multiUser.isSuperUser,
        "isEmailVerified" -> (multiUser.isEmailVerified || !conf.WebKnossos.User.EmailVerification.activated),
      )
    }
  }

  def publicWritesCompact(userCompactInfo: UserCompactInfo): Fox[JsObject] =
    for {
      _ <- Fox.successful(())
      teamsJson = parseArrayLiteral(userCompactInfo.teamIdsAsArrayLiteral).indices.map(
        idx =>
          Json.obj(
            "id" -> parseArrayLiteral(userCompactInfo.teamIdsAsArrayLiteral)(idx),
            "name" -> parseArrayLiteral(userCompactInfo.teamNamesAsArrayLiteral)(idx),
            "isTeamManager" -> parseArrayLiteral(userCompactInfo.teamManagersAsArrayLiteral)(idx).toBoolean
        ))
      experienceJson = Json.obj(
        parseArrayLiteral(userCompactInfo.experienceValuesAsArrayLiteral).zipWithIndex
          .filter(valueAndIndex => tryo(valueAndIndex._1.toInt).isDefined)
          .map(valueAndIndex =>
            (parseArrayLiteral(userCompactInfo.experienceDomainsAsArrayLiteral)(valueAndIndex._2),
             Json.toJsFieldJsValueWrapper(valueAndIndex._1.toInt))): _*)
      novelUserExperienceInfos <- JsonHelper.parseAs[JsObject](userCompactInfo.novelUserExperienceInfos).toFox
    } yield {
      Json.obj(
        "id" -> userCompactInfo._id,
        "email" -> userCompactInfo.email,
        "firstName" -> userCompactInfo.firstName,
        "lastName" -> userCompactInfo.lastName,
        "isAdmin" -> userCompactInfo.isAdmin,
        "isOrganizationOwner" -> userCompactInfo.isOrganizationOwner,
        "isDatasetManager" -> userCompactInfo.isDatasetManager,
        "isActive" -> !userCompactInfo.isDeactivated,
        "teams" -> teamsJson,
        "experiences" -> experienceJson,
        "lastActivity" -> userCompactInfo.lastActivity,
        "isAnonymous" -> false,
        "isEditable" -> userCompactInfo.isEditable,
        "organization" -> userCompactInfo.organizationId,
        "novelUserExperienceInfos" -> novelUserExperienceInfos,
        "selectedTheme" -> userCompactInfo.selectedTheme,
        "created" -> userCompactInfo.created,
        "lastTaskTypeId" -> userCompactInfo.lastTaskTypeId,
        "isSuperUser" -> userCompactInfo.isSuperUser,
        "isEmailVerified" -> userCompactInfo.isEmailVerified,
        "isGuest" -> userCompactInfo.isGuest,
      )
    }

  def compactWrites(user: User): Fox[JsObject] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      teamMemberships <- teamMembershipsFor(user._id)
      email <- emailFor(user)
      teamMembershipsJs <- Fox.serialCombined(teamMemberships)(tm => teamMembershipService.publicWrites(tm))
    } yield {
      Json.obj(
        "id" -> user._id.toString,
        "email" -> email,
        "firstName" -> user.firstName,
        "lastName" -> user.lastName,
        "isAdmin" -> user.isAdmin,
        "isDatasetManager" -> user.isDatasetManager,
        "isAnonymous" -> false,
        "teams" -> teamMembershipsJs
      )
    }
  }
}
