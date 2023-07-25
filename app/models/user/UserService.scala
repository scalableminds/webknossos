package models.user

import akka.actor.ActorSystem
import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.services.IdentityService
import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DataSetViewConfiguration.DataSetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.typesafe.scalalogging.LazyLogging
import models.binary.DataSetDAO
import models.team._
import oxalis.mail.{DefaultMails, Send}
import oxalis.security.{PasswordHasher, TokenDAO}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json._
import utils.{ObjectId, WkConf}

import javax.inject.Inject
import models.organization.OrganizationDAO
import net.liftweb.common.{Box, Full}

import scala.concurrent.{ExecutionContext, Future}

class UserService @Inject()(conf: WkConf,
                            userDAO: UserDAO,
                            multiUserDAO: MultiUserDAO,
                            userExperiencesDAO: UserExperiencesDAO,
                            userDataSetConfigurationDAO: UserDataSetConfigurationDAO,
                            userDataSetLayerConfigurationDAO: UserDataSetLayerConfigurationDAO,
                            organizationDAO: OrganizationDAO,
                            teamDAO: TeamDAO,
                            teamMembershipService: TeamMembershipService,
                            dataSetDAO: DataSetDAO,
                            tokenDAO: TokenDAO,
                            emailVerificationService: EmailVerificationService,
                            defaultMails: DefaultMails,
                            passwordHasher: PasswordHasher,
                            actorSystem: ActorSystem)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
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
          maybeLastLoggedInIdentity <- userDAO.findOne(userId).futureBox
          identity <- maybeLastLoggedInIdentity match {
            case Full(user) if !user.isDeactivated => Fox.successful(user)
            case _                                 => userDAO.findFirstByMultiUser(multiUser._id)
          }
        } yield identity
      case None => userDAO.findFirstByMultiUser(multiUser._id)
    }

  def findOneByEmailAndOrganization(email: String, organizationId: ObjectId)(implicit ctx: DBAccessContext): Fox[User] =
    for {
      multiUser <- multiUserDAO.findOneByEmail(email)
      user <- userDAO.findOneByOrgaAndMultiUser(organizationId, multiUser._id)
    } yield user

  def assertNotInOrgaYet(multiUserId: ObjectId, organizationId: ObjectId): Fox[Unit] =
    for {
      userBox <- userDAO.findOneByOrgaAndMultiUser(organizationId, multiUserId)(GlobalAccessContext).futureBox
      _ <- bool2Fox(userBox.isEmpty) ?~> "organization.alreadyJoined"
    } yield ()

  def assertIsSuperUser(multiUserId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    Fox.assertTrue(multiUserDAO.findOne(multiUserId).map(_.isSuperUser))

  def findOneCached(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[User] =
    userCache.getOrLoad((userId, ctx.toStringAnonymous), _ => userDAO.findOne(userId))

  def insert(organizationId: ObjectId,
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

  def fillSuperUserIdentity(originalUser: User, organizationId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      multiUser <- multiUserDAO.findOne(originalUser._multiUser)
      existingIdentity: Box[User] <- userDAO
        .findOneByOrgaAndMultiUser(organizationId, originalUser._multiUser)(GlobalAccessContext)
        .futureBox
      _ <- if (multiUser.isSuperUser && existingIdentity.isEmpty) {
        joinOrganization(originalUser, organizationId, autoActivate = true, isAdmin = true, isUnlisted = true)
      } else Fox.successful(())
    } yield ()

  def joinOrganization(originalUser: User,
                       organizationId: ObjectId,
                       autoActivate: Boolean,
                       isAdmin: Boolean = false,
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

  def getOpenIdConnectPasswordInfo: PasswordInfo =
    PasswordInfo("Empty", "")

  def updateUserConfiguration(user: User, configuration: JsObject)(implicit ctx: DBAccessContext): Fox[Unit] =
    userDAO.updateUserConfiguration(user._id, configuration).map { result =>
      removeUserFromCache(user._id)
      result
    }

  def updateDataSetViewConfiguration(
      user: User,
      dataSetName: String,
      organizationName: String,
      dataSetConfiguration: DataSetViewConfiguration,
      layerConfiguration: Option[JsValue])(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[Unit] =
    for {
      dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName)(GlobalAccessContext) ?~> Messages(
        "dataSet.notFound",
        dataSetName)
      layerMap = layerConfiguration.flatMap(_.asOpt[Map[String, JsValue]]).getOrElse(Map.empty)
      _ <- Fox.serialCombined(layerMap.toList) {
        case (name, config) =>
          config.asOpt[LayerViewConfiguration] match {
            case Some(viewConfiguration) =>
              userDataSetLayerConfigurationDAO.updateDatasetConfigurationForUserAndDatasetAndLayer(user._id,
                                                                                                   dataSet._id,
                                                                                                   name,
                                                                                                   viewConfiguration)
            case None => Fox.successful(())
          }
      }
      _ <- userDataSetConfigurationDAO.updateDatasetConfigurationForUserAndDataset(user._id,
                                                                                   dataSet._id,
                                                                                   dataSetConfiguration)
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
    userDAO.findTeamMembershipsForUser(_user)

  def teamManagerMembershipsFor(_user: ObjectId): Fox[List[TeamMembership]] =
    for {
      teamMemberships <- teamMembershipsFor(_user)
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
                                 _organization: ObjectId,
                                 teamManagerMemberships: Option[List[TeamMembership]] = None): Fox[Boolean] =
    for {
      teamManagerMemberships <- Fox.fillOption(teamManagerMemberships)(teamManagerMembershipsFor(user._id))
    } yield teamManagerMemberships.nonEmpty && _organization == user._organization

  def isTeamManagerOrAdminOfOrg(user: User, _organization: ObjectId): Fox[Boolean] =
    for {
      isTeamManager <- isTeamManagerInOrg(user, _organization)
    } yield isTeamManager || user.isAdminOf(_organization)

  def isEditableBy(possibleEditee: User, possibleEditor: User): Fox[Boolean] =
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
        "organization" -> organization.name,
        "novelUserExperienceInfos" -> novelUserExperienceInfos,
        "selectedTheme" -> multiUser.selectedTheme,
        "created" -> user.created,
        "lastTaskTypeId" -> user.lastTaskTypeId.map(_.toString),
        "isSuperUser" -> multiUser.isSuperUser,
        "isEmailVerified" -> multiUser.isEmailVerified,
      )
    }
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
