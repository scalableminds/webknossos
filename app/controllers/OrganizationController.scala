package controllers

import akka.actor.ActorSystem
import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.organization.{OrganizationDAO, OrganizationService}
import models.user.{InviteDAO, MultiUserDAO, UserDAO, UserService}
import oxalis.security.{WkEnv, WkSilhouetteEnvironment}
import play.api.i18n.Messages
import play.api.libs.functional.syntax._
import play.api.libs.json.{JsNull, JsValue, Json, __}
import play.api.mvc.{Action, AnyContent}
import utils.WkConf
import oxalis.mail.{DefaultMails, Send}

import scala.concurrent.ExecutionContext

class OrganizationController @Inject()(organizationDAO: OrganizationDAO,
                                       organizationService: OrganizationService,
                                       inviteDAO: InviteDAO,
                                       conf: WkConf,
                                       userDAO: UserDAO,
                                       multiUserDAO: MultiUserDAO,
                                       wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                       userService: UserService,
                                       defaultMails: DefaultMails,
                                       actorSystem: ActorSystem,
                                       sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
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

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organizations <- organizationDAO.findAll ?~> "organization.list.failed"
      js <- Fox.serialCombined(organizations)(o => organizationService.publicWrites(o))
    } yield Ok(Json.toJson(js))
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
      _ <- bool2Fox(invite.expirationDateTime.isAfterNow)
      organization <- organizationDAO.findOne(invite._organization)
      organizationJson <- organizationService.publicWrites(organization)
    } yield Ok(organizationJson)
  }

  def getOperatorData: Action[AnyContent] = Action {
    Ok(Json.toJson(conf.WebKnossos.operatorData))
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
      _ = logger.info(s"Deleting organizaion ${organization._id}")
      _ <- organizationDAO.deleteOne(organization._id)
      _ <- userDAO.deleteAllWithOrganization(organization._id)
      _ <- multiUserDAO.removeLastLoggedInIdentitiesWithOrga(organization._id)
      _ <- combinedAuthenticatorService.discard(request.authenticator, Ok)
    } yield Ok
  }

  private val organizationUpdateReads =
    ((__ \ 'displayName).read[String] and
      (__ \ 'newUserMailingList).read[String]).tupled

  def sendExtendPricingPlanEmail(organizationName: String): Action[AnyContent] = sil.SecuredAction.async { implicit request => 
    for {
          organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                      organizationName) ~> NOT_FOUND
          userEmail <- userService.emailFor(request.identity)
          _ = Mailer ! Send(defaultMails.extendPricingPlanMail(request.identity, userEmail, organization.displayName))
        } yield Ok
    }

  def sendUpgradePricingPlanEmail(organizationName: String): Action[AnyContent] = sil.SecuredAction.async { implicit request => 
    for {
          organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                      organizationName) ~> NOT_FOUND
          userEmail <- userService.emailFor(request.identity)
          _ = Mailer ! Send(defaultMails.upgradePricingPlanToTeamMail(request.identity, userEmail, organization.displayName))
        } yield Ok
    }
  
  def sendUpgradePricingPlanUsersEmail(organizationName: String, requestedUsers: Int): Action[AnyContent] = sil.SecuredAction.async { implicit request => 
    for {
          organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                      organizationName) ~> NOT_FOUND
          userEmail <- userService.emailFor(request.identity)
          _ = Mailer ! Send(defaultMails.upgradePricingPlanUsersMail(request.identity, userEmail, organization.displayName, requestedUsers))
        } yield Ok
    }

  def sendUpgradePricingPlanStorageEmail(organizationName: String, requestedStorage: Int): Action[AnyContent] = sil.SecuredAction.async { implicit request => 
    for {
          organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                      organizationName) ~> NOT_FOUND
          userEmail <- userService.emailFor(request.identity)
          _ = Mailer ! Send(defaultMails.upgradePricingPlanStorageMail(request.identity, userEmail, organization.displayName, requestedStorage))
        } yield Ok
    }

}
