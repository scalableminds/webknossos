package controllers

import com.scalableminds.util.Msg
import org.apache.pekko.actor.ActorSystem
import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{JsonAutoFormat, Fox}
import com.scalableminds.util.tools.Fox.toFox
import mail.{DefaultMails, Send}

import javax.inject.Inject
import models.organization.{
  ByteCount,
  FreeCreditTransactionService,
  Organization,
  OrganizationDAO,
  OrganizationPlanUpdate,
  OrganizationService,
  PricingPlan,
  UpgradeRequest
}
import models.user.{InviteDAO, MultiUserDAO, UserDAO, UserService}
import play.api.libs.json.{JsNull, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.WkConf

import scala.concurrent.duration.*
import security.{WkEnv, WkSilhouetteEnvironment}

import scala.concurrent.ExecutionContext

case class OrganizationParameters(name: String, newUserMailingList: String) derives JsonAutoFormat

class OrganizationController @Inject() (
    organizationDAO: OrganizationDAO,
    organizationService: OrganizationService,
    inviteDAO: InviteDAO,
    conf: WkConf,
    userDAO: UserDAO,
    multiUserDAO: MultiUserDAO,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
    userService: UserService,
    defaultMails: DefaultMails,
    freeCreditTransactionService: FreeCreditTransactionService,
    actorSystem: ActorSystem,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends Controller {

  private val combinedAuthenticatorService = wkSilhouetteEnvironment.combinedAuthenticatorService
  private lazy val Mailer = actorSystem.actorSelection("/user/mailActor")

  def organizationsIsEmpty: Action[AnyContent] = Action.fox { _ =>
    for {
      orgaTableIsEmpty <- organizationDAO.isEmpty ?~> Msg.Organization.listFailed
    } yield Ok(Json.toJson(orgaTableIsEmpty))
  }

  def get(organizationId: String): Action[AnyContent] =
    sil.UserAwareAction.fox { implicit request =>
      for {
        org <- organizationDAO.findOne(organizationId)(using GlobalAccessContext)
        js <- organizationService.publicWrites(org, request.identity)
      } yield Ok(Json.toJson(js))
    }

  def list(compact: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      organizations <- organizationDAO.findAll ?~> Msg.Organization.listFailed
      js <-
        if (compact.getOrElse(false)) Fox.successful(organizations.map(organizationService.compactWrites))
        else Fox.serialCombined(organizations)(o => organizationService.publicWrites(o))
    } yield Ok(Json.toJson(js))
  }

  case class OrganizationCreationParameters(organization: Option[String], organizationName: String, ownerEmail: String)
      derives JsonAutoFormat
  def create: Action[OrganizationCreationParameters] =
    sil.SecuredAction.fox(validateJson[OrganizationCreationParameters]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity._multiUser) ?~> Msg.notAllowed ~> FORBIDDEN
        owner <- multiUserDAO.findOneByEmail(request.body.ownerEmail) ?~> Msg.User.notFound
        org <- organizationService.createOrganization(request.body.organization, request.body.organizationName)
        user <- userDAO.findFirstByMultiUser(owner._id)
        teamMemberships <- userService.initialTeamMemberships(org._id, inviteIdOpt = None)
        _ <- userService.joinOrganization(
          user,
          org._id,
          autoActivate = true,
          isAdmin = true,
          isDatasetManager = false,
          isOrganizationOwner = true,
          teamMemberships = teamMemberships
        )
        _ <- freeCreditTransactionService.handOutMonthlyFreeCredits()
      } yield Ok(org._id)
    }

  def getDefault: Action[AnyContent] = sil.UserAwareAction.fox { implicit request =>
    for {
      allOrgs <- organizationDAO.findAll(using GlobalAccessContext) ?~> Msg.Organization.listFailed
      org <- allOrgs.headOption.toFox ?~> Msg.Organization.listFailed
      js <- organizationService.publicWrites(org, request.identity)
    } yield
      if (allOrgs.length > 1) // Cannot list organizations publicly if there are multiple ones, due to privacy reasons
        Ok(JsNull)
      else
        Ok(Json.toJson(js))
  }

  def getByInvite(inviteToken: String): Action[AnyContent] = Action.fox { _ =>
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      invite <- inviteDAO.findOneByTokenValue(inviteToken)
      _ <- Fox.fromBool(!invite.expirationDateTime.isPast)
      organization <- organizationDAO.findOne(invite._organization)
      organizationJson <- organizationService.publicWrites(organization)
    } yield Ok(organizationJson)
  }

  def getOperatorData: Action[AnyContent] = Action {
    addNoCacheHeaderFallback(Ok(Json.toJson(conf.WebKnossos.operatorData)))
  }

  def getTermsOfService: Action[AnyContent] = Action {
    addNoCacheHeaderFallback(
      Ok(
        Json.obj(
          "version" -> conf.WebKnossos.TermsOfService.version,
          "enabled" -> conf.WebKnossos.TermsOfService.enabled,
          "url" -> conf.WebKnossos.TermsOfService.url
        )
      )
    )
  }

  def termsOfServiceAcceptanceNeeded: Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      needsAcceptance = conf.WebKnossos.TermsOfService.enabled &&
        organization.lastTermsOfServiceAcceptanceVersion < conf.WebKnossos.TermsOfService.version
      acceptanceDeadline = conf.WebKnossos.TermsOfService.acceptanceDeadline
    } yield Ok(
      Json.obj(
        "acceptanceNeeded" -> needsAcceptance,
        "acceptanceDeadline" -> acceptanceDeadline,
        "acceptanceDeadlinePassed" -> acceptanceDeadline.isPast
      )
    )
  }

  def acceptTermsOfService(version: Int): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- Fox.fromBool(request.identity.isOrganizationOwner) ?~> Msg.Organization.TermsOfService.onlyOrganizationOwner
      _ <- organizationService.acceptTermsOfService(request.identity._organization, version)
    } yield Ok
  }

  def update(organizationId: String): Action[OrganizationParameters] =
    sil.SecuredAction.fox(validateJson[OrganizationParameters]) { implicit request =>
      for {
        organization <- organizationDAO.findOne(organizationId) ?~> Msg.Organization.notFound(
          organizationId
        ) ~> NOT_FOUND
        _ <- Fox.fromBool(request.identity.isAdminOf(organization._id)) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- organizationDAO.updateFields(organization._id, request.body.name, request.body.newUserMailingList)
        updated <- organizationDAO.findOne(organization._id)
        organizationJson <- organizationService.publicWrites(updated, Some(request.identity))
      } yield Ok(organizationJson)
    }

  def delete(organizationId: String): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      organization <- organizationDAO.findOne(organizationId) ?~> Msg.Organization.notFound(organizationId) ~> NOT_FOUND
      _ <- Fox.fromBool(request.identity.isAdminOf(organization._id)) ?~> Msg.notAllowed ~> FORBIDDEN
      _ = logger.info(s"Deleting organization ${organization._id}")
      _ <- organizationDAO.deleteOne(organization._id)
      _ <- userDAO.deleteAllWithOrganization(organization._id)
      _ <- multiUserDAO.removeLastLoggedInIdentitiesWithOrga(organization._id)
      _ <- Fox.fromFuture(combinedAuthenticatorService.discard(request.authenticator, Ok))
    } yield Ok
  }

  def addUser(organizationId: String): Action[String] =
    sil.SecuredAction.fox(validateJson[String]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity._multiUser) ?~> Msg.notAllowed ~> FORBIDDEN
        multiUser <- multiUserDAO.findOneByEmail(request.body)
        organization <- organizationDAO.findOne(organizationId) ?~> Msg.Organization.notFound(
          organizationId
        ) ~> NOT_FOUND
        user <- userDAO.findFirstByMultiUser(multiUser._id)
        teamMemberships <- userService.initialTeamMemberships(organization._id, inviteIdOpt = None)
        user <- userService.joinOrganization(
          user,
          organization._id,
          autoActivate = true,
          isAdmin = false,
          isDatasetManager = false,
          teamMemberships = teamMemberships
        )
      } yield Ok(user._id.toString)
    }

  private def aiAddonLabelForPricingPlan(pricingPlan: PricingPlan.PricingPlan): String =
    pricingPlan match {
      case PricingPlan.Team | PricingPlan.Team_Trial   => "Team AI"
      case PricingPlan.Power | PricingPlan.Power_Trial => "Power AI"
      case _                                           => "AI Add-on"
    }

  private def pluralize(count: Int, singular: String): String =
    s"$count $singular${if (count == 1) "" else "s"}"

  // Only the items that were actually requested are listed in the email.
  private def describeUpgradeRequest(upgradeRequest: UpgradeRequest, organization: Organization): Seq[String] = {
    val currentPlanLabel = PricingPlan.label(organization.pricingPlan)
    val effectivePlan = upgradeRequest.plan.getOrElse(organization.pricingPlan)
    Seq(
      upgradeRequest.plan.map(plan => s"Upgrade from $currentPlanLabel to ${PricingPlan.label(plan)} plan"),
      upgradeRequest.users.map(users => pluralize(users, "additional user")),
      upgradeRequest.storageTB.map(storageTB => s"$storageTB TB additional storage"),
      Option.when(upgradeRequest.aiAddon.contains(true))(
        s"AI Add-on (${aiAddonLabelForPricingPlan(effectivePlan)})"
      ),
      upgradeRequest.credits.map(credits => pluralize(credits, "WEBKNOSSOS credit")),
      upgradeRequest.extendYears.map(years => s"Plan extension by ${pluralize(years, "year")}")
    ).flatten
  }

  def sendUpgradeRequestEmail(): Action[UpgradeRequest] =
    sil.SecuredAction.fox(validateJson[UpgradeRequest]) { implicit request =>
      val upgradeRequest = request.body
      for {
        _ <- Fox.fromBool(request.identity.isAdmin) ?~> Msg.Organization.pricingUpdatesOnlyAdmin
        _ <- Fox.fromBool(upgradeRequest.credits.isEmpty || request.identity.isOrganizationOwner) ?~>
          Msg.Organization.creditOrdersOnlyOwner
        _ <- Fox.fromBool(upgradeRequest.hasValidAmounts) ?~> Msg.Organization.upgradeRequestInvalidAmount
        _ <- Fox.fromBool(upgradeRequest.note.forall(_.length <= UpgradeRequest.maxNoteLength)) ?~>
          Msg.Organization.upgradeRequestNoteTooLong(UpgradeRequest.maxNoteLength)
        organization <- organizationDAO.findOne(request.identity._organization) ?~> Msg.Organization.notFound(
          request.identity._organization
        ) ~> NOT_FOUND
        requestedChanges = describeUpgradeRequest(upgradeRequest, organization)
        _ <- Fox.fromBool(requestedChanges.nonEmpty) ?~> Msg.Organization.upgradeRequestEmpty
        multiUser <- multiUserDAO.findOne(request.identity._multiUser)
        _ = logger.info(
          s"Received upgrade request for organization ${organization._id} by user ${request.identity._id}: ${requestedChanges
              .mkString(", ")}"
        )
        note = upgradeRequest.note.map(_.trim).filter(_.nonEmpty)
        _ = Mailer ! Send(defaultMails.upgradeRequestMail(multiUser, organization.name, requestedChanges, note))
      } yield Ok
    }

  def pricingStatus: Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      for {
        organization <- organizationDAO.findOne(request.identity._organization)
        activeUserCount <- userDAO.countAllForOrganization(request.identity._organization)
        // Note that this does not yet account for storage
        isExceeded = organization.includedUsers.exists(userLimit =>
          activeUserCount > userLimit
        ) || organization.paidUntil.exists(_.isPast)
        isAlmostExceeded = (activeUserCount > 1 && organization.includedUsers.exists(userLimit =>
          activeUserCount > userLimit - 2
        )) || organization.paidUntil.exists(paidUntil => (paidUntil - (6 * 7 days)).isPast)
      } yield Ok(
        Json.obj(
          "pricingPlan" -> organization.pricingPlan,
          "isExceeded" -> isExceeded,
          "isAlmostExceeded" -> isAlmostExceeded
        )
      )
    }

  def updatePlan(): Action[OrganizationPlanUpdate] =
    sil.SecuredAction.fox(validateJson[OrganizationPlanUpdate]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        organization <- organizationDAO.findOne(request.body.organizationId) ?~> Msg.Organization.notFound(
          request.body.organizationId
        ) ~> NOT_FOUND
        _ <- organizationDAO.insertPlanUpdate(organization._id, request.body)
        _ <- organizationDAO.updatePlan(organization._id, request.body)
        // Note that this logs its failures rather than propagating them, as the plan update above has
        // already been persisted at this point.
        _ <- Fox.runOptional(request.body.pricingPlan)(newPricingPlan =>
          organizationService.sendPricingPlanUpgradeMails(organization, organization.pricingPlan, newPricingPlan)
        )
      } yield Ok
    }

  def listPlanUpdates: Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      for {
        isSuperUser <- userService.isSuperUser(request.identity._multiUser)
        _ <- Fox.fromBool(isSuperUser || request.identity.isAdmin) ?~> Msg.Organization.listPlanUpdatesOnlyAdmin
        planUpdates <- organizationDAO.findPlanUpdates(request.identity._organization)
        planUpdatesWithFallback <-
          if (planUpdates.nonEmpty) {
            Fox.successful(planUpdates)
          } else {
            organizationDAO
              .findOne(request.identity._organization)
              .map(organization => Seq(defaultPlanUpdate(organization)))
          }
      } yield Ok(Json.toJson(planUpdatesWithFallback))
    }

  private def defaultPlanUpdate(organization: Organization): OrganizationPlanUpdate =
    OrganizationPlanUpdate(
      organizationId = organization._id,
      description = Some("Organization created"),
      pricingPlan = Some(organization.pricingPlan),
      aiPlan = Some(organization.aiPlan),
      paidUntil = organization.paidUntil.map(Some(_)),
      includedUsers = organization.includedUsers.map(Some(_)),
      includedStorageBytes = organization.includedStorageBytes.map(numBytes => Some(ByteCount(numBytes))),
      created = organization.created
    )

}
