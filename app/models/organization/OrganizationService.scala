package models.organization

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import models.dataset.{DataStore, DataStoreDAO}
import models.folder.{Folder, FolderDAO, FolderService}
import models.team.{PricingPlan, Team, TeamDAO}
import models.user.{Invite, MultiUserDAO, User, UserDAO, UserService}
import play.api.libs.json.{JsObject, Json}
import utils.{ObjectId, WkConf}

import scala.concurrent.{ExecutionContext, Future}

class OrganizationService @Inject()(organizationDAO: OrganizationDAO,
                                    multiUserDAO: MultiUserDAO,
                                    userDAO: UserDAO,
                                    teamDAO: TeamDAO,
                                    dataStoreDAO: DataStoreDAO,
                                    folderDAO: FolderDAO,
                                    folderService: FolderService,
                                    userService: UserService,
                                    rpc: RPC,
                                    conf: WkConf,
)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  def compactWrites(organization: Organization): JsObject =
    Json.obj(
      "id" -> organization._id,
      "name" -> organization.name,
      "displayName" -> organization.displayName
    )

  def publicWrites(organization: Organization, requestingUser: Option[User] = None): Fox[JsObject] = {

    val adminOnlyInfo = if (requestingUser.exists(_.isAdminOf(organization._id))) {
      Json.obj(
        "newUserMailingList" -> organization.newUserMailingList,
        "lastTermsOfServiceAcceptanceTime" -> organization.lastTermsOfServiceAcceptanceTime,
        "lastTermsOfServiceAcceptanceVersion" -> organization.lastTermsOfServiceAcceptanceVersion
      )
    } else Json.obj()
    for {
      usedStorageBytes <- organizationDAO.getUsedStorage(organization._id)
      ownerBox <- userDAO.findOwnerByOrg(organization._id).futureBox
      ownerNameOpt = ownerBox.toOption.map(o => s"${o.firstName} ${o.lastName}")
    } yield
      Json.obj(
        "id" -> organization._id.toString,
        "name" -> organization.name,
        "additionalInformation" -> organization.additionalInformation,
        "enableAutoVerify" -> organization.enableAutoVerify,
        "displayName" -> organization.displayName,
        "pricingPlan" -> organization.pricingPlan,
        "paidUntil" -> organization.paidUntil,
        "includedUsers" -> organization.includedUsers,
        "includedStorageBytes" -> organization.includedStorageBytes,
        "usedStorageBytes" -> usedStorageBytes,
        "ownerName" -> ownerNameOpt
      ) ++ adminOnlyInfo
  }

  def findOneByInviteByNameOrDefault(inviteOpt: Option[Invite], organizationNameOpt: Option[String])(
      implicit ctx: DBAccessContext): Fox[Organization] =
    inviteOpt match {
      case Some(invite) => organizationDAO.findOne(invite._organization)
      case None =>
        organizationNameOpt match {
          case Some(organizationName) => organizationDAO.findOneByName(organizationName)
          case None =>
            for {
              allOrganizations <- organizationDAO.findAll
              _ <- bool2Fox(allOrganizations.length == 1) ?~> "organization.ambiguous"
              defaultOrganization <- allOrganizations.headOption
            } yield defaultOrganization
        }

    }

  def assertMayCreateOrganization(requestingUser: Option[User]): Fox[Unit] = {
    val activatedInConfig = bool2Fox(conf.Features.isWkorgInstance) ?~> "allowOrganizationCreation.notEnabled"
    val userIsSuperUser = requestingUser.toFox.flatMap(user =>
      multiUserDAO.findOne(user._multiUser)(GlobalAccessContext).flatMap(multiUser => bool2Fox(multiUser.isSuperUser)))

    // If at least one of the conditions is fulfilled, success is returned.
    Fox
      .sequenceOfFulls[Unit](List(assertNoOrganizationsPresent, activatedInConfig, userIsSuperUser))
      .map(_.headOption)
      .toFox
  }

  def assertNoOrganizationsPresent: Fox[Unit] =
    for {
      organizations <- organizationDAO.findAll(GlobalAccessContext)
      _ <- bool2Fox(organizations.isEmpty) ?~> "organizationsNotEmpty"
    } yield ()

  def createOrganization(organizationNameOpt: Option[String], organizationDisplayName: String): Fox[Organization] =
    for {
      normalizedDisplayName <- TextUtils.normalizeStrong(organizationDisplayName).toFox ?~> "organization.name.invalid"
      organizationName = organizationNameOpt
        .flatMap(TextUtils.normalizeStrong)
        .getOrElse(normalizedDisplayName)
        .replaceAll(" ", "_")
      existingOrganization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext).futureBox
      _ <- bool2Fox(existingOrganization.isEmpty) ?~> "organization.name.alreadyInUse"
      initialPricingParameters = if (conf.Features.isWkorgInstance) (PricingPlan.Basic, Some(3), Some(50000000000L))
      else (PricingPlan.Custom, None, None)
      organizationRootFolder = Folder(ObjectId.generate, folderService.defaultRootName, JsObject.empty)

      organization = Organization(
        ObjectId.generate,
        organizationName,
        "",
        "",
        organizationDisplayName,
        initialPricingParameters._1,
        None,
        initialPricingParameters._2,
        initialPricingParameters._3,
        organizationRootFolder._id
      )
      organizationTeam = Team(ObjectId.generate, organization._id, "Default", isOrganizationTeam = true)
      _ <- folderDAO.insertAsRoot(organizationRootFolder)
      _ <- organizationDAO.insertOne(organization)
      _ <- teamDAO.insertOne(organizationTeam)
    } yield organization

  def createOrganizationDirectory(organizationName: String, dataStoreToken: String): Fox[Unit] = {
    def sendRPCToDataStore(dataStore: DataStore) =
      rpc(s"${dataStore.url}/data/triggers/createOrganizationDirectory")
        .addQueryString("token" -> dataStoreToken, "organizationName" -> organizationName)
        .post()
        .futureBox

    for {
      datastores <- dataStoreDAO.findAll(GlobalAccessContext)
      _ <- Future.sequence(datastores.map(sendRPCToDataStore))
    } yield ()
  }

  def assertUsersCanBeAdded(organizationId: ObjectId, usersToAddCount: Int = 1)(implicit ctx: DBAccessContext,
                                                                                ec: ExecutionContext): Fox[Unit] =
    for {
      organization <- organizationDAO.findOne(organizationId)
      userCount <- userDAO.countAllForOrganization(organizationId)
      _ <- Fox.runOptional(organization.includedUsers)(includedUsers =>
        bool2Fox(userCount + usersToAddCount <= includedUsers))
    } yield ()

  private def fallbackOnOwnerEmail(possiblyEmptyEmail: String, organization: Organization)(
      implicit ctx: DBAccessContext): Fox[String] =
    if (possiblyEmptyEmail.nonEmpty) {
      Fox.successful(possiblyEmptyEmail)
    } else {
      for {
        owner <- userDAO.findOwnerByOrg(organization._id)
        ownerEmail <- userService.emailFor(owner)
      } yield ownerEmail
    }

  def newUserMailRecipient(organization: Organization)(implicit ctx: DBAccessContext): Fox[String] =
    fallbackOnOwnerEmail(organization.newUserMailingList, organization)

}
