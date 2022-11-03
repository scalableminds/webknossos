package models.organization

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.rpc.RPC
import controllers.InitialDataService

import javax.inject.Inject
import models.binary.{DataStore, DataStoreDAO}
import models.team.{PricingPlan, Team, TeamDAO}
import models.user.{Invite, MultiUserDAO, User, UserDAO}
import play.api.libs.json.{JsObject, Json}
import utils.{ObjectId, WkConf}

import scala.concurrent.{ExecutionContext, Future}

class OrganizationService @Inject()(organizationDAO: OrganizationDAO,
                                    multiUserDAO: MultiUserDAO,
                                    userDAO: UserDAO,
                                    teamDAO: TeamDAO,
                                    dataStoreDAO: DataStoreDAO,
                                    rpc: RPC,
                                    initialDataService: InitialDataService,
                                    conf: WkConf,
)(implicit ec: ExecutionContext)
    extends FoxImplicits {

  def publicWrites(organization: Organization, requestingUser: Option[User] = None): Fox[JsObject] = {
    val adminOnlyInfo = if (requestingUser.exists(_.isAdminOf(organization._id))) {
      Json.obj(
        "newUserMailingList" -> organization.newUserMailingList,
        "pricingPlan" -> organization.pricingPlan,
        "paidUntil" -> organization.paidUntil,
        "includedUsers" -> organization.includedUsers,
        "includedStorage" -> organization.includedStorage.map(bytes => bytes / 1000000)
      )
    } else Json.obj()
    Fox.successful(
      Json.obj(
        "id" -> organization._id.toString,
        "name" -> organization.name,
        "additionalInformation" -> organization.additionalInformation,
        "enableAutoVerify" -> organization.enableAutoVerify,
        "displayName" -> organization.displayName
      ) ++ adminOnlyInfo
    )
  }

  def findOneByInviteByNameOrDefault(inviteOpt: Option[Invite], organizatioNameOpt: Option[String])(
      implicit ctx: DBAccessContext): Fox[Organization] =
    inviteOpt match {
      case Some(invite) => organizationDAO.findOne(invite._organization)
      case None =>
        organizatioNameOpt match {
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
    val noOrganizationPresent = initialDataService.assertNoOrganizationsPresent
    val activatedInConfig = bool2Fox(conf.Features.isDemoInstance) ?~> "allowOrganizationCreation.notEnabled"
    val userIsSuperUser = requestingUser.toFox.flatMap(user =>
      multiUserDAO.findOne(user._multiUser)(GlobalAccessContext).flatMap(multiUser => bool2Fox(multiUser.isSuperUser)))

    Fox.sequenceOfFulls[Unit](List(noOrganizationPresent, activatedInConfig, userIsSuperUser)).map(_.headOption).toFox
  }

  def createOrganization(organizationNameOpt: Option[String], organizationDisplayName: String): Fox[Organization] =
    for {
      normalizedDisplayName <- TextUtils.normalizeStrong(organizationDisplayName).toFox ?~> "organization.name.invalid"
      organizationName = organizationNameOpt
        .flatMap(TextUtils.normalizeStrong)
        .getOrElse(normalizedDisplayName)
        .replaceAll(" ", "_")
      existingOrganization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext).futureBox
      _ <- bool2Fox(existingOrganization.isEmpty) ?~> "organization.name.alreadyInUse"
      initialPricingParameters = if (conf.Features.isDemoInstance) (PricingPlan.Basic, Some(3), Some(50000000000L))
      else (PricingPlan.Custom, None, None)
      organization = Organization(
        ObjectId.generate,
        organizationName,
        "",
        "",
        organizationDisplayName,
        initialPricingParameters._1,
        None,
        initialPricingParameters._2,
        initialPricingParameters._3
      )
      organizationTeam = Team(ObjectId.generate, organization._id, "Default", isOrganizationTeam = true)
      _ <- organizationDAO.insertOne(organization)
      _ <- teamDAO.insertOne(organizationTeam)
      _ <- initialDataService.insertLocalDataStoreIfEnabled()
    } yield organization

  def createOrganizationFolder(organizationName: String, dataStoreToken: String): Fox[Unit] = {
    def sendRPCToDataStore(dataStore: DataStore) =
      rpc(s"${dataStore.url}/data/triggers/newOrganizationFolder")
        .addQueryString("token" -> dataStoreToken, "organizationName" -> organizationName)
        .post
        .futureBox

    for {
      datastores <- dataStoreDAO.findAll(GlobalAccessContext)
      _ <- Future.sequence(datastores.map(sendRPCToDataStore))
    } yield ()
  }

  def assertUsersCanBeAdded(organization: Organization, usersToAddCount: Int = 1)(implicit ctx: DBAccessContext,
                                                                                  ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- organizationDAO.findOne(organization._id)
      userCount <- userDAO.countAllForOrganization(organization._id)
      _ <- Fox.runOptional(organization.includedUsers)(includedUsers =>
        bool2Fox(userCount + usersToAddCount <= includedUsers))
    } yield ()

}
