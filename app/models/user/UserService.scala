package models.user

import akka.actor.ActorSystem
import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.services.IdentityService
import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.mail.Send
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DataSetViewConfiguration.DataSetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import models.binary.DataSetDAO
import models.configuration.UserConfiguration
import models.team._
import oxalis.mail.DefaultMails
import oxalis.security.TokenDAO
import oxalis.user.UserCache
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json._
import utils.{ObjectId, WkConf}

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

class UserService @Inject()(conf: WkConf,
                            userDAO: UserDAO,
                            multiUserDAO: MultiUserDAO,
                            userTeamRolesDAO: UserTeamRolesDAO,
                            userExperiencesDAO: UserExperiencesDAO,
                            userDataSetConfigurationDAO: UserDataSetConfigurationDAO,
                            userDataSetLayerConfigurationDAO: UserDataSetLayerConfigurationDAO,
                            organizationDAO: OrganizationDAO,
                            teamDAO: TeamDAO,
                            teamMembershipService: TeamMembershipService,
                            dataSetDAO: DataSetDAO,
                            tokenDAO: TokenDAO,
                            defaultMails: DefaultMails,
                            userCache: UserCache,
                            actorSystem: ActorSystem)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with IdentityService[User] {

  lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  val defaultUserEmail = conf.Application.Authentication.DefaultUser.email

  def defaultUser: Fox[User] =
    userDAO.findOneByEmail(defaultUserEmail)(GlobalAccessContext)

  def findOneById(userId: ObjectId, useCache: Boolean)(implicit ctx: DBAccessContext): Fox[User] =
    if (useCache)
      userCache.findUser(userId)
    else
      userCache.store(userId, userDAO.findOne(userId))

  def logActivity(_user: ObjectId, lastActivity: Long) =
    userDAO.updateLastActivity(_user, lastActivity)(GlobalAccessContext)

  def insert(_organization: ObjectId,
             email: String,
             firstName: String,
             lastName: String,
             isActive: Boolean,
             isOrgTeamManager: Boolean = false,
             loginInfo: LoginInfo,
             passwordInfo: PasswordInfo,
             isAdmin: Boolean = false): Fox[User] = {
    implicit val ctx: GlobalAccessContext.type = GlobalAccessContext
    for {
      _ <- Fox.assertTrue(multiUserDAO.emailNotPresentYet(email)(GlobalAccessContext)) ?~> "user.email.alreadyInUse"
      multiUserId = ObjectId.generate
      multiUser = MultiUser(
        multiUserId,
        email,
        passwordInfo,
        isSuperUser = false
      )
      _ <- multiUserDAO.insertOne(multiUser)
      organizationTeamId <- organizationDAO.findOrganizationTeamId(_organization)
      orgTeam <- teamDAO.findOne(organizationTeamId)
      teamMemberships = List(TeamMembership(orgTeam._id, isTeamManager = false))
      user = User(
        ObjectId.generate,
        multiUserId,
        _organization,
        firstName,
        lastName,
        System.currentTimeMillis(),
        Json.toJson(UserConfiguration.default),
        loginInfo,
        isAdmin,
        isDatasetManager = false,
        isDeactivated = !isActive,
        lastTaskTypeId = None
      )
      _ <- userDAO.insertOne(user)
      _ <- Fox.combined(teamMemberships.map(userTeamRolesDAO.insertTeamMembership(user._id, _)))
    } yield user
  }

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
      Mailer ! Send(defaultMails.activatedMail(user.name, email))
    }
    for {
      oldEmail <- emailFor(user)
      _ <- multiUserDAO.updateEmail(user._multiUser, email)
      _ <- userDAO.updateValues(user._id,
                                firstName,
                                lastName,
                                isAdmin,
                                isDatasetManager,
                                isDeactivated = !activated,
                                lastTaskTypeId)
      _ <- userTeamRolesDAO.updateTeamMembershipsForUser(user._id, teamMemberships)
      _ <- userExperiencesDAO.updateExperiencesForUser(user._id, experiences)
      _ = userCache.invalidateUser(user._id)
      _ <- if (oldEmail == email) Fox.successful(()) else tokenDAO.updateEmail(oldEmail, email)
      updated <- userDAO.findOne(user._id)
    } yield updated
  }

  def changePasswordInfo(loginInfo: LoginInfo, passwordInfo: PasswordInfo) =
    for {
      user <- findOneByEmail(loginInfo.providerKey)
      _ <- multiUserDAO.updatePasswordInfo(user._id, passwordInfo)(GlobalAccessContext)
    } yield {
      passwordInfo
    }

  def findOneByEmail(email: String): Fox[User] =
    userDAO.findOneByEmail(email)(GlobalAccessContext)

  def updateUserConfiguration(user: User, configuration: UserConfiguration)(implicit ctx: DBAccessContext) =
    userDAO.updateUserConfiguration(user._id, configuration).map { result =>
      userCache.invalidateUser(user._id)
      result
    }

  def updateDataSetViewConfiguration(
      user: User,
      dataSetName: String,
      organizationName: String,
      dataSetConfiguration: DataSetViewConfiguration,
      layerConfiguration: Option[JsValue])(implicit ctx: DBAccessContext, m: MessagesProvider) =
    for {
      dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName) ?~> Messages(
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

  def updateLastTaskTypeId(user: User, lastTaskTypeId: Option[String])(implicit ctx: DBAccessContext) =
    userDAO.updateLastTaskTypeId(user._id, lastTaskTypeId).map { result =>
      userCache.invalidateUser(user._id)
      result
    }

  def retrieve(loginInfo: LoginInfo): Future[Option[User]] =
    findOneById(ObjectId(loginInfo.providerKey), useCache = false)(GlobalAccessContext).futureBox.map(_.toOption)

  def createLoginInfo(userId: ObjectId): LoginInfo =
    LoginInfo(CredentialsProvider.ID, userId.id)

  def createPasswordInfo(pw: String): PasswordInfo =
    PasswordInfo("SCrypt", SCrypt.hashPassword(pw))

  def experiencesFor(_user: ObjectId): Fox[Map[String, Int]] =
    userExperiencesDAO.findAllExperiencesForUser(_user)(GlobalAccessContext)

  def teamMembershipsFor(_user: ObjectId): Fox[List[TeamMembership]] =
    userTeamRolesDAO.findTeamMembershipsForUser(_user)(GlobalAccessContext)

  def teamManagerMembershipsFor(_user: ObjectId): Fox[List[TeamMembership]] =
    for {
      teamMemberships <- teamMembershipsFor(_user)
    } yield teamMemberships.filter(_.isTeamManager)

  def teamManagerTeamIdsFor(_user: ObjectId) =
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
    } yield (otherUserTeamIds.intersect(teamManagerTeamIds).nonEmpty || possibleAdmin.isAdminOf(otherUser))

  def isTeamManagerOrAdminOf(user: User, _team: ObjectId): Fox[Boolean] =
    (for {
      team <- teamDAO.findOne(_team)(GlobalAccessContext)
      teamManagerTeamIds <- teamManagerTeamIdsFor(user._id)
    } yield (teamManagerTeamIds.contains(_team) || user.isAdminOf(team._organization))) ?~> "team.admin.notAllowed"

  def isTeamManagerInOrg(user: User,
                         _organization: ObjectId,
                         teamManagerMemberships: Option[List[TeamMembership]] = None): Fox[Boolean] =
    for {
      teamManagerMemberships <- Fox.fillOption(teamManagerMemberships)(teamManagerMembershipsFor(user._id))
    } yield (teamManagerMemberships.nonEmpty && _organization == user._organization)

  def isTeamManagerOrAdminOfOrg(user: User, _organization: ObjectId): Fox[Boolean] =
    for {
      isTeamManager <- isTeamManagerInOrg(user, _organization)
    } yield (isTeamManager || user.isAdminOf(_organization))

  def isEditableBy(possibleEditee: User, possibleEditor: User): Fox[Boolean] =
    for {
      otherIsTeamManagerOrAdmin <- isTeamManagerOrAdminOf(possibleEditor, possibleEditee)
      teamMemberships <- teamMembershipsFor(possibleEditee._id)
    } yield (otherIsTeamManagerOrAdmin || teamMemberships.isEmpty)

  def publicWrites(user: User, requestingUser: User): Fox[JsObject] = {
    implicit val ctx = GlobalAccessContext
    for {
      isEditable <- isEditableBy(user, requestingUser)
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext)
      teamMemberships <- teamMembershipsFor(user._id)
      email <- emailFor(user)
      teamMembershipsJs <- Fox.serialCombined(teamMemberships)(tm => teamMembershipService.publicWrites(tm))
      experiences <- experiencesFor(user._id)
    } yield {
      Json.obj(
        "id" -> user._id.toString,
        "email" -> email,
        "firstName" -> user.firstName,
        "lastName" -> user.lastName,
        "isAdmin" -> user.isAdmin,
        "isDatasetManager" -> user.isDatasetManager,
        "isActive" -> !user.isDeactivated,
        "teams" -> teamMembershipsJs,
        "experiences" -> experiences,
        "lastActivity" -> user.lastActivity,
        "isAnonymous" -> false,
        "isEditable" -> isEditable,
        "organization" -> organization.name,
        "created" -> user.created,
        "lastTaskTypeId" -> user.lastTaskTypeId.map(_.toString)
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
