package models.organization

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import controllers.RpcTokenHolder

import javax.inject.Inject
import models.dataset.{DataStore, DataStoreDAO}
import models.folder.{Folder, FolderDAO, FolderService}
import models.team.{Team, TeamDAO}
import models.user.{Invite, MultiUserDAO, User, UserDAO, UserService}
import play.api.libs.json.{JsArray, JsObject, Json}
import utils.WkConf

import scala.concurrent.{ExecutionContext, Future}

class OrganizationService @Inject()(organizationDAO: OrganizationDAO,
                                    multiUserDAO: MultiUserDAO,
                                    userDAO: UserDAO,
                                    teamDAO: TeamDAO,
                                    creditTransactionDAO: CreditTransactionDAO,
                                    dataStoreDAO: DataStoreDAO,
                                    folderDAO: FolderDAO,
                                    folderService: FolderService,
                                    userService: UserService,
                                    rpc: RPC,
                                    conf: WkConf)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  def compactWrites(organization: Organization): JsObject =
    Json.obj(
      "id" -> organization._id,
      "name" -> organization.name
    )

  def publicWrites(organization: Organization, requestingUser: Option[User] = None)(
      implicit ctx: DBAccessContext): Fox[JsObject] = {

    val adminOnlyInfo = if (requestingUser.exists(_.isAdminOf(organization._id))) {
      Json.obj(
        "newUserMailingList" -> organization.newUserMailingList,
        "lastTermsOfServiceAcceptanceTime" -> organization.lastTermsOfServiceAcceptanceTime,
        "lastTermsOfServiceAcceptanceVersion" -> organization.lastTermsOfServiceAcceptanceVersion
      )
    } else Json.obj()
    for {
      usedStorageBytes <- organizationDAO.getUsedStorage(organization._id)
      ownerMultiUserBox <- multiUserDAO.findMultiUserOfOrganizationOwner(organization._id).shiftBox
      milliCreditBalanceOpt <- Fox.runIf(requestingUser.exists(_._organization == organization._id))(
        creditTransactionDAO.getMilliCreditBalance(organization._id))
      ownerNameOpt = ownerMultiUserBox.toOption.map(o => o.fullName)
    } yield
      Json.obj(
        "id" -> organization._id,
        "name" -> organization._id, // Included for backwards compatibility
        "additionalInformation" -> organization.additionalInformation,
        "enableAutoVerify" -> organization.enableAutoVerify,
        "name" -> organization.name,
        "pricingPlan" -> organization.pricingPlan,
        "aiPlan" -> organization.aiPlan,
        "paidUntil" -> organization.paidUntil,
        "includedUsers" -> organization.includedUsers,
        "includedStorageBytes" -> organization.includedStorageBytes,
        "usedStorageBytes" -> usedStorageBytes,
        "ownerName" -> ownerNameOpt,
        "milliCreditBalance" -> milliCreditBalanceOpt
      ) ++ adminOnlyInfo
  }

  def assertUsedStorageNotExceeded(organization: Organization,
                                   additionalRequestedStorage: Option[Long] = None): Fox[Unit] =
    for {
      usedStorageBytes <- organizationDAO.getUsedStorage(organization._id)
      _ <- Fox.runOptional(organization.includedStorageBytes)(includedStorage =>
        Fox.fromBool(usedStorageBytes + additionalRequestedStorage.getOrElse(0L) <= includedStorage)) ?~> Msg.Organization.storageExceeded
    } yield ()

  def findOneByInviteOrDefault(inviteOpt: Option[Invite])(implicit ctx: DBAccessContext): Fox[Organization] =
    inviteOpt match {
      case Some(invite) => organizationDAO.findOne(invite._organization) ?~> Msg.Organization.notFoundByInvite
      case None =>
        for {
          allOrganizations <- organizationDAO.findAll(GlobalAccessContext)
          _ <- Fox.fromBool(allOrganizations.length == 1) ?~> Msg.Organization.ambiguous
          defaultOrganization <- allOrganizations.headOption.toFox
        } yield defaultOrganization
    }

  def assertMayCreateOrganization(requestingUser: Option[User]): Fox[Unit] = {
    val activatedInConfig = Fox.fromBool(conf.Features.isWkorgInstance) ?~> Msg.Organization.allowOrganizationCreationNotEnabled
    val userIsSuperUser = requestingUser.toFox.flatMap(
      user =>
        multiUserDAO
          .findOne(user._multiUser)(GlobalAccessContext)
          .flatMap(multiUser => Fox.fromBool(multiUser.isSuperUser)))

    // If at least one of the conditions is fulfilled, success is returned.
    for {
      fulls <- Fox.fromFuture(
        Fox.sequenceOfFulls[Unit](List(assertNoOrganizationsPresent, activatedInConfig, userIsSuperUser)))
      _ <- Fox.fromBool(fulls.nonEmpty)
    } yield ()
  }

  def assertNoOrganizationsPresent: Fox[Unit] =
    for {
      organizations <- organizationDAO.findAll(GlobalAccessContext)
      _ <- Fox.fromBool(organizations.isEmpty) ?~> Msg.organizationsNotEmpty
    } yield ()

  def createOrganization(organizationIdOpt: Option[String], organizationName: String): Fox[Organization] =
    for {
      normalizedName <- TextUtils.normalizeStrong(organizationName).toFox ?~> Msg.Organization.idInvalid
      organizationId = organizationIdOpt
        .flatMap(TextUtils.normalizeStrong)
        .getOrElse(normalizedName)
        .replaceAll(" ", "_")
      existingOrganization <- organizationDAO.findOne(organizationId)(GlobalAccessContext).shiftBox
      _ <- Fox.fromBool(existingOrganization.isEmpty) ?~> Msg.Organization.idAlreadyInUse
      initialPricingParameters = if (conf.Features.isWkorgInstance) (PricingPlan.Personal, Some(1), Some(50000000000L))
      else (PricingPlan.Custom, None, None)
      organizationRootFolder = Folder(ObjectId.generate, folderService.defaultRootName, JsArray.empty)

      organization = Organization(
        organizationId,
        "",
        "",
        organizationName,
        initialPricingParameters._1,
        None,
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

  def createOrganizationDirectory(organizationId: String): Fox[Unit] = {
    def sendRPCToDataStore(dataStore: DataStore) =
      rpc(s"${dataStore.url}/data/triggers/createOrganizationDirectory")
        .addQueryParam("token", RpcTokenHolder.webknossosToken)
        .addQueryParam("organizationId", organizationId)
        .postEmpty()
        .futureBox

    for {
      datastores <- dataStoreDAO.findAll(GlobalAccessContext)
      _ <- Fox.fromFuture(Future.sequence(datastores.map(sendRPCToDataStore)))
    } yield ()
  }

  def assertUsersCanBeAdded(organizationId: String, usersToAddCount: Int = 1)(implicit ctx: DBAccessContext,
                                                                              ec: ExecutionContext): Fox[Unit] =
    for {
      organization <- organizationDAO.findOne(organizationId)
      userCount <- userDAO.countAllForOrganization(organizationId)
      _ <- Fox.runOptional(organization.includedUsers)(includedUsers =>
        Fox.fromBool(userCount + usersToAddCount <= includedUsers))
    } yield ()

  private def fallbackOnOwnerEmail(possiblyEmptyEmail: String, organization: Organization): Fox[String] =
    if (possiblyEmptyEmail.nonEmpty) {
      Fox.successful(possiblyEmptyEmail)
    } else {
      for {
        ownerMultiUser <- multiUserDAO.findMultiUserOfOrganizationOwner(organization._id)
      } yield ownerMultiUser.email
    }

  def newUserMailRecipient(organization: Organization): Fox[String] =
    fallbackOnOwnerEmail(organization.newUserMailingList, organization)

  def acceptTermsOfService(organizationId: String, version: Int)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- Fox.fromBool(conf.WebKnossos.TermsOfService.enabled) ?~> Msg.Organization.TermsOfService.notEnabled
      requiredVersion = conf.WebKnossos.TermsOfService.version
      _ <- Fox.fromBool(version == requiredVersion) ?~> Msg.Organization.TermsOfService
        .versionMismatch(requiredVersion, version)
      _ <- organizationDAO.acceptTermsOfService(organizationId, version, Instant.now)
    } yield ()

  def assertIsSuperUserOrOrganizationHasAiPlan(user: User)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      organization <- organizationDAO.findOne(user._organization)
      _ <- assertIsSuperUserOrOrganizationHasAiPlan(organization, user)
    } yield ()

  def assertIsSuperUserOrOrganizationHasAiPlan(organization: Organization, user: User)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      isSuperUser <- userService.isSuperUser(user._multiUser)
      _ <- Fox.runIf(!isSuperUser)(Fox.fromBool(organization.aiPlan.isDefined)) ?~> Msg.Job.CreditTransaction.noAiPlan
    } yield ()

}
