package models.organization

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import models.dataset.{DataStore, DataStoreDAO}
import models.folder.{Folder, FolderDAO, FolderService}
import models.team.{PricingPlan, Team, TeamDAO}
import models.user.{Invite, MultiUserDAO, User, UserDAO, UserService}
import play.api.i18n.{Messages, MessagesProvider}
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
      ownerBox <- userDAO.findOwnerByOrg(organization._id).shiftBox
      creditBalanceOpt <- Fox.runIf(requestingUser.exists(_._organization == organization._id))(
        creditTransactionDAO.getCreditBalance(organization._id))
      ownerNameOpt = ownerBox.toOption.map(o => s"${o.firstName} ${o.lastName}")
    } yield
      Json.obj(
        "id" -> organization._id,
        "name" -> organization._id, // Included for backwards compatibility
        "additionalInformation" -> organization.additionalInformation,
        "enableAutoVerify" -> organization.enableAutoVerify,
        "name" -> organization.name,
        "pricingPlan" -> organization.pricingPlan,
        "paidUntil" -> organization.paidUntil,
        "includedUsers" -> organization.includedUsers,
        "includedStorageBytes" -> organization.includedStorageBytes,
        "usedStorageBytes" -> usedStorageBytes,
        "ownerName" -> ownerNameOpt,
        "creditBalance" -> creditBalanceOpt.map(_.toString)
      ) ++ adminOnlyInfo
  }

  def findOneByInviteByIdOrDefault(inviteOpt: Option[Invite], organizationIdOpt: Option[String])(
      implicit ctx: DBAccessContext): Fox[Organization] =
    inviteOpt match {
      case Some(invite) => organizationDAO.findOne(invite._organization)
      case None =>
        organizationIdOpt match {
          case Some(organizationId) => organizationDAO.findOne(organizationId)
          case None =>
            for {
              allOrganizations <- organizationDAO.findAll
              _ <- Fox.fromBool(allOrganizations.length == 1) ?~> "organization.ambiguous"
              defaultOrganization <- allOrganizations.headOption.toFox
            } yield defaultOrganization
        }
    }

  def assertMayCreateOrganization(requestingUser: Option[User]): Fox[Unit] = {
    val activatedInConfig = Fox.fromBool(conf.Features.isWkorgInstance) ?~> "allowOrganizationCreation.notEnabled"
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
      _ <- Fox.fromBool(organizations.isEmpty) ?~> "organizationsNotEmpty"
    } yield ()

  def createOrganization(organizationIdOpt: Option[String], organizationName: String): Fox[Organization] =
    for {
      normalizedName <- TextUtils.normalizeStrong(organizationName).toFox ?~> "organization.id.invalid"
      organizationId = organizationIdOpt
        .flatMap(TextUtils.normalizeStrong)
        .getOrElse(normalizedName)
        .replaceAll(" ", "_")
      existingOrganization <- organizationDAO.findOne(organizationId)(GlobalAccessContext).shiftBox
      _ <- Fox.fromBool(existingOrganization.isEmpty) ?~> "organization.id.alreadyInUse"
      initialPricingParameters = if (conf.Features.isWkorgInstance) (PricingPlan.Basic, Some(3), Some(50000000000L))
      else (PricingPlan.Custom, None, None)
      organizationRootFolder = Folder(ObjectId.generate, folderService.defaultRootName, JsArray.empty)

      organization = Organization(
        organizationId,
        "",
        "",
        organizationName,
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

  def createOrganizationDirectory(organizationId: String, dataStoreToken: String): Fox[Unit] = {
    def sendRPCToDataStore(dataStore: DataStore) =
      rpc(s"${dataStore.url}/data/triggers/createOrganizationDirectory")
        .addQueryString("token" -> dataStoreToken, "organizationId" -> organizationId)
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

  def acceptTermsOfService(organizationId: String, version: Int)(implicit ctx: DBAccessContext,
                                                                 m: MessagesProvider): Fox[Unit] =
    for {
      _ <- Fox.fromBool(conf.WebKnossos.TermsOfService.enabled) ?~> "termsOfService.notEnabled"
      requiredVersion = conf.WebKnossos.TermsOfService.version
      _ <- Fox.fromBool(version == requiredVersion) ?~> Messages("termsOfService.versionMismatch",
                                                                 requiredVersion,
                                                                 version)
      _ <- organizationDAO.acceptTermsOfService(organizationId, version, Instant.now)
    } yield ()

  // Currently disabled as in the credit system trail phase all organizations should be able to start paid jobs.
  // See tracking issue: https://github.com/scalableminds/webknossos/issues/8458
  def assertOrganizationHasPaidPlan(organizationId: String): Fox[Unit] = Fox.successful(())

}
