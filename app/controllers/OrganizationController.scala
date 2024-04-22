package controllers

import org.apache.pekko.actor.ActorSystem
import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import mail.{DefaultMails, Send}

import javax.inject.Inject
import models.organization.{OrganizationDAO, OrganizationService}
import models.user.{InviteDAO, MultiUserDAO, UserDAO, UserService}
import models.team.PricingPlan
import play.api.i18n.Messages
import play.api.libs.functional.syntax._
import play.api.libs.json.{JsNull, JsValue, Json, OFormat, __}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.WkConf

import scala.concurrent.duration._
import security.{WkEnv, WkSilhouetteEnvironment}

import scala.concurrent.ExecutionContext

class OrganizationController @Inject()(
    organizationDAO: OrganizationDAO,
    organizationService: OrganizationService,
    inviteDAO: InviteDAO,
    conf: WkConf,
    userDAO: UserDAO,
    multiUserDAO: MultiUserDAO,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
    userService: UserService,
    defaultMails: DefaultMails,
    actorSystem: ActorSystem,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  private val combinedAuthenticatorService = wkSilhouetteEnvironment.combinedAuthenticatorService
  private lazy val Mailer = actorSystem.actorSelection("/user/mailActor")

  def organizationsIsEmpty: Action[AnyContent] = Action.async { implicit request =>
    for {
      allOrgs <- organizationDAO.findAll(GlobalAccessContext) ?~> "organization.list.failed"
    } yield {
      Ok(Json.toJson(allOrgs.isEmpty))
    }
  }

  def get(organizationName: String): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      for {
        org <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext)
        js <- organizationService.publicWrites(org, request.identity)
      } yield {
        Ok(Json.toJson(js))
      }
    }

  def list(compact: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organizations <- organizationDAO.findAll ?~> "organization.list.failed"
      js <- if (compact.getOrElse(false)) Fox.successful(organizations.map(organizationService.compactWrites))
      else Fox.serialCombined(organizations)(o => organizationService.publicWrites(o))
    } yield Ok(Json.toJson(js))
  }

  case class OrganizationCreationParameters(organization: Option[String],
                                            organizationDisplayName: String,
                                            ownerEmail: String)
  object OrganizationCreationParameters {
    implicit val jsonFormat: OFormat[OrganizationCreationParameters] = Json.format[OrganizationCreationParameters]
  }
  def create: Action[OrganizationCreationParameters] =
    sil.SecuredAction.async(validateJson[OrganizationCreationParameters]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity._multiUser) ?~> "notAllowed" ~> FORBIDDEN
        owner <- multiUserDAO.findOneByEmail(request.body.ownerEmail) ?~> "user.notFound"
        org <- organizationService.createOrganization(request.body.organization, request.body.organizationDisplayName)
        user <- userDAO.findFirstByMultiUser(owner._id)
        _ <- userService.joinOrganization(user,
                                          org._id,
                                          autoActivate = true,
                                          isAdmin = true,
                                          isOrganizationOwner = true)
      } yield Ok(org.name)
    }

  def getDefault: Action[AnyContent] = Action.async { implicit request =>
    for {
      allOrgs <- organizationDAO.findAll(GlobalAccessContext) ?~> "organization.list.failed"
      org <- allOrgs.headOption.toFox ?~> "organization.list.failed"
      js <- organizationService.publicWrites(org)
    } yield {
      if (allOrgs.length > 1) // Cannot list organizations publicly if there are multiple ones, due to privacy reasons
        Ok(JsNull)
      else
        Ok(Json.toJson(js))
    }
  }

  def getByInvite(inviteToken: String): Action[AnyContent] = Action.async { implicit request =>
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      invite <- inviteDAO.findOneByTokenValue(inviteToken)
      _ <- bool2Fox(!invite.expirationDateTime.isPast)
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
        )))
  }

  def termsOfServiceAcceptanceNeeded: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      needsAcceptance = conf.WebKnossos.TermsOfService.enabled &&
        organization.lastTermsOfServiceAcceptanceVersion < conf.WebKnossos.TermsOfService.version
      acceptanceDeadline = conf.WebKnossos.TermsOfService.acceptanceDeadline
      deadlinePassed = acceptanceDeadline.toEpochMilli < System.currentTimeMillis()
    } yield
      Ok(
        Json.obj(
          "acceptanceNeeded" -> needsAcceptance,
          "acceptanceDeadline" -> acceptanceDeadline.toEpochMilli,
          "acceptanceDeadlinePassed" -> deadlinePassed
        ))
  }

  def acceptTermsOfService(version: Int): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(request.identity.isOrganizationOwner) ?~> "termsOfService.onlyOrganizationOwner"
      _ <- bool2Fox(conf.WebKnossos.TermsOfService.enabled) ?~> "termsOfService.notEnabled"
      requiredVersion = conf.WebKnossos.TermsOfService.version
      _ <- bool2Fox(version == requiredVersion) ?~> Messages("termsOfService.versionMismatch", requiredVersion, version)
      _ <- organizationDAO.acceptTermsOfService(request.identity._organization, version, Instant.now)
    } yield Ok
  }

  def update(organizationName: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(organizationUpdateReads) {
      case (displayName, newUserMailingList) =>
        for {
          organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                       organizationName) ~> NOT_FOUND
          _ <- bool2Fox(request.identity.isAdminOf(organization._id)) ?~> "notAllowed" ~> FORBIDDEN
          _ <- organizationDAO.updateFields(organization._id, displayName, newUserMailingList)
          updated <- organizationDAO.findOne(organization._id)
          organizationJson <- organizationService.publicWrites(updated)
        } yield Ok(organizationJson)
    }
  }

  def delete(organizationName: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                   organizationName) ~> NOT_FOUND
      _ <- bool2Fox(request.identity.isAdminOf(organization._id)) ?~> "notAllowed" ~> FORBIDDEN
      _ = logger.info(s"Deleting organization ${organization._id}")
      _ <- organizationDAO.deleteOne(organization._id)
      _ <- userDAO.deleteAllWithOrganization(organization._id)
      _ <- multiUserDAO.removeLastLoggedInIdentitiesWithOrga(organization._id)
      _ <- combinedAuthenticatorService.discard(request.authenticator, Ok)
    } yield Ok
  }

  def addUser(organizationName: String): Action[String] =
    sil.SecuredAction.async(validateJson[String]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity._multiUser) ?~> "notAllowed" ~> FORBIDDEN
        multiUser <- multiUserDAO.findOneByEmail(request.body)
        organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                     organizationName) ~> NOT_FOUND
        user <- userDAO.findFirstByMultiUser(multiUser._id)
        user <- userService.joinOrganization(user, organization._id, autoActivate = true, isAdmin = false)
      } yield Ok(user._id.toString)
    }

  private val organizationUpdateReads =
    ((__ \ "displayName").read[String] and
      (__ \ "newUserMailingList").read[String]).tupled

  def sendExtendPricingPlanEmail(): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(request.identity.isAdmin) ?~> Messages("organization.pricingUpgrades.notAuthorized")
      organization <- organizationDAO
        .findOne(request.identity._organization) ?~> Messages("organization.notFound") ~> NOT_FOUND
      userEmail <- userService.emailFor(request.identity)
      _ = Mailer ! Send(defaultMails.extendPricingPlanMail(request.identity, userEmail))
      _ = Mailer ! Send(
        defaultMails.upgradePricingPlanRequestMail(request.identity,
                                                   organization.displayName,
                                                   "Extend WEBKNOSSOS plan by a year"))
    } yield Ok
  }

  def sendUpgradePricingPlanEmail(requestedPlan: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> Messages("organization.pricingUpgrades.notAuthorized")
        organization <- organizationDAO
          .findOne(request.identity._organization) ?~> Messages("organization.notFound") ~> NOT_FOUND
        userEmail <- userService.emailFor(request.identity)
        requestedPlan <- PricingPlan.fromString(requestedPlan)
        mail = if (requestedPlan == PricingPlan.Team) {
          defaultMails.upgradePricingPlanToTeamMail _
        } else {
          defaultMails.upgradePricingPlanToTeamMail _
        }
        _ = Mailer ! Send(mail(request.identity, userEmail))
        _ = Mailer ! Send(
          defaultMails.upgradePricingPlanRequestMail(request.identity,
                                                     organization.displayName,
                                                     s"Upgrade WEBKNOSSOS Plan to $requestedPlan"))
      } yield Ok
  }

  def sendUpgradePricingPlanUsersEmail(requestedUsers: Int): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> Messages("organization.pricingUpgrades.notAuthorized")
        organization <- organizationDAO.findOne(request.identity._organization) ?~> Messages("organization.notFound") ~> NOT_FOUND
        userEmail <- userService.emailFor(request.identity)
        _ = Mailer ! Send(defaultMails.upgradePricingPlanUsersMail(request.identity, userEmail, requestedUsers))
        _ = Mailer ! Send(
          defaultMails.upgradePricingPlanRequestMail(request.identity,
                                                     organization.displayName,
                                                     s"Purchase $requestedUsers additional users"))
      } yield Ok
    }

  def sendUpgradePricingPlanStorageEmail(requestedStorage: Int): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> Messages("organization.pricingUpgrades.notAuthorized")
        organization <- organizationDAO.findOne(request.identity._organization) ?~> Messages("organization.notFound") ~> NOT_FOUND
        userEmail <- userService.emailFor(request.identity)
        _ = Mailer ! Send(defaultMails.upgradePricingPlanStorageMail(request.identity, userEmail, requestedStorage))
        _ = Mailer ! Send(
          defaultMails.upgradePricingPlanRequestMail(request.identity,
                                                     organization.displayName,
                                                     s"Purchase $requestedStorage TB additional storage"))
      } yield Ok
    }

  def pricingStatus: Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOne(request.identity._organization)
        activeUserCount <- userDAO.countAllForOrganization(request.identity._organization)
        // Note that this does not yet account for storage
        isExceeded = organization.includedUsers.exists(userLimit => activeUserCount > userLimit) || organization.paidUntil
          .exists(_.isPast)
        isAlmostExceeded = (activeUserCount > 1 && organization.includedUsers.exists(userLimit =>
          activeUserCount > userLimit - 2)) || organization.paidUntil.exists(paidUntil =>
          (paidUntil - (6 * 7 days)).isPast)
      } yield
        Ok(
          Json.obj(
            "pricingPlan" -> organization.pricingPlan,
            "isExceeded" -> isExceeded,
            "isAlmostExceeded" -> isAlmostExceeded
          ))
    }

}
