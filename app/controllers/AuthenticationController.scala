package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import mail.{DefaultMails, MailchimpClient, MailchimpTag, Send}
import models.analytics.{AnalyticsService, InviteEvent, JoinOrganizationEvent, SignupEvent}
import models.organization.{Organization, OrganizationDAO, OrganizationService}
import models.user._
import net.liftweb.common.{Box, Empty, Failure, Full}
import org.apache.commons.codec.binary.Base64
import org.apache.commons.codec.digest.{HmacAlgorithms, HmacUtils}
import org.apache.pekko.actor.ActorSystem
import play.api.data.Form
import play.api.data.Forms._
import play.api.data.validation.Constraints._
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json._
import play.api.mvc._
import play.silhouette.api.actions.SecuredRequest
import play.silhouette.api.exceptions.ProviderException
import play.silhouette.api.services.AuthenticatorResult
import play.silhouette.api.util.{Credentials, PasswordInfo}
import play.silhouette.api.{LoginInfo, Silhouette}
import play.silhouette.impl.providers.CredentialsProvider
import security._
import utils.WkConf

import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

class AuthenticationController @Inject()(
    actorSystem: ActorSystem,
    credentialsProvider: CredentialsProvider,
    passwordHasher: PasswordHasher,
    userService: UserService,
    authenticationService: AccessibleBySwitchingService,
    organizationService: OrganizationService,
    inviteService: InviteService,
    inviteDAO: InviteDAO,
    mailchimpClient: MailchimpClient,
    organizationDAO: OrganizationDAO,
    analyticsService: AnalyticsService,
    userDAO: UserDAO,
    multiUserDAO: MultiUserDAO,
    defaultMails: DefaultMails,
    conf: WkConf,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
    openIdConnectClient: OpenIdConnectClient,
    initialDataService: InitialDataService,
    emailVerificationService: EmailVerificationService,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with AuthForms
    with FoxImplicits {

  private val combinedAuthenticatorService = wkSilhouetteEnvironment.combinedAuthenticatorService
  private val bearerTokenAuthenticatorService = combinedAuthenticatorService.tokenAuthenticatorService

  private lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  private lazy val ssoKey =
    conf.WebKnossos.User.ssoKey

  private lazy val isOIDCEnabled = conf.Features.openIdConnectEnabled

  def register: Action[AnyContent] = Action.async { implicit request =>
    signUpForm
      .bindFromRequest()
      .fold(
        bogusForm => Future.successful(BadRequest(bogusForm.toString)),
        signUpData => {
          for {
            (firstName, lastName, email, errors) <- validateNameAndEmail(signUpData.firstName,
                                                                         signUpData.lastName,
                                                                         signUpData.email)
            result <- if (errors.nonEmpty) {
              Fox.successful(BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t))))))
            } else {
              for {
                _ <- Fox.successful(())
                inviteBox: Box[Invite] <- Fox.future2Fox(
                  inviteService.findInviteByTokenOpt(signUpData.inviteToken).futureBox)
                organizationId = Option(signUpData.organization).filter(_.trim.nonEmpty)
                organization <- organizationService.findOneByInviteByIdOrDefault(inviteBox.toOption, organizationId)(
                  GlobalAccessContext) ?~> Messages("organization.notFound", signUpData.organization)
                _ <- organizationService
                  .assertUsersCanBeAdded(organization._id)(GlobalAccessContext, ec) ?~> "organization.users.userLimitReached"
                autoActivate = inviteBox.toOption.map(_.autoActivate).getOrElse(organization.enableAutoVerify)
                _ <- createUser(organization,
                                email,
                                firstName,
                                lastName,
                                autoActivate,
                                Option(signUpData.password),
                                inviteBox)
              } yield Ok
            }
          } yield {
            result
          }

        }
      )
  }

  private def createUser(organization: Organization,
                         email: String,
                         firstName: String,
                         lastName: String,
                         autoActivate: Boolean,
                         password: Option[String],
                         inviteBox: Box[Invite] = Empty,
                         isEmailVerified: Boolean = false): Fox[User] = {
    val passwordInfo: PasswordInfo = userService.getPasswordInfo(password)
    for {
      user <- userService.insert(organization._id,
                                 email,
                                 firstName,
                                 lastName,
                                 autoActivate,
                                 passwordInfo,
                                 isAdmin = false,
                                 isOrganizationOwner = false,
                                 isEmailVerified = isEmailVerified) ?~> "user.creation.failed"
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      _ = analyticsService.track(SignupEvent(user, inviteBox.isDefined))
      _ <- Fox.runIf(inviteBox.isDefined)(Fox.runOptional(inviteBox.toOption)(i =>
        inviteService.deactivateUsedInvite(i)(GlobalAccessContext)))
      newUserEmailRecipient <- organizationService.newUserMailRecipient(organization)(GlobalAccessContext)
      _ = if (conf.Features.isWkorgInstance) {
        mailchimpClient.registerUser(user, multiUser, tag = MailchimpTag.RegisteredAsUser)
      } else {
        Mailer ! Send(defaultMails.newUserMail(user.name, email, autoActivate))
      }
      _ = Mailer ! Send(
        defaultMails.registerAdminNotifierMail(user.name, email, organization, autoActivate, newUserEmailRecipient))
    } yield {
      user
    }
  }

  def authenticate: Action[AnyContent] = Action.async { implicit request =>
    signInForm
      .bindFromRequest()
      .fold(
        bogusForm => Future.successful(BadRequest(bogusForm.toString)),
        signInData => {
          val email = signInData.email.toLowerCase
          val userFopt: Future[Option[User]] =
            userService.userFromMultiUserEmail(email)(GlobalAccessContext).futureBox.map(_.toOption)
          val idF = userFopt.map(userOpt => userOpt.map(_._id.id).getOrElse("")) // do not fail here if there is no user for email. Fail below.
          idF
            .map(id => Credentials(id, signInData.password))
            .flatMap(credentials => credentialsProvider.authenticate(credentials))
            .flatMap {
              loginInfo =>
                userService.retrieve(loginInfo).flatMap {
                  case Some(user) if !user.isDeactivated =>
                    for {
                      authenticator <- combinedAuthenticatorService.create(loginInfo)
                      value <- combinedAuthenticatorService.init(authenticator)
                      result <- combinedAuthenticatorService.embed(value, Ok)
                      _ <- Fox.runIf(conf.WebKnossos.User.EmailVerification.activated)(emailVerificationService
                        .assertEmailVerifiedOrResendVerificationMail(user)(GlobalAccessContext, ec))
                      _ <- multiUserDAO.updateLastLoggedInIdentity(user._multiUser, user._id)(GlobalAccessContext)
                      _ = userDAO.updateLastActivity(user._id)(GlobalAccessContext)
                      _ = logger.info(f"User ${user._id} authenticated.")
                    } yield result
                  case None =>
                    Future.successful(BadRequest(Messages("error.noUser")))
                  case Some(_) => Future.successful(BadRequest(Messages("user.deactivated")))
                }
            }
            .recover {
              case _: ProviderException => BadRequest(Messages("error.invalidCredentials"))
            }
        }
      )
  }

  def switchMultiUser(email: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    implicit val ctx: GlobalAccessContext.type = GlobalAccessContext
    for {
      requestingMultiUser <- multiUserDAO.findOne(request.identity._multiUser)
      _ <- Fox.fromBool(requestingMultiUser.isSuperUser) ?~> Messages("user.notAuthorised") ~> FORBIDDEN
      targetUser <- userService.userFromMultiUserEmail(email) ?~> "user.notFound" ~> NOT_FOUND
      result <- Fox.future2Fox(switchToUser(targetUser._id))
    } yield result
  }

  def switchOrganization(organizationId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO
        .findOne(organizationId) ?~> Messages("organization.notFound", organizationId) ~> NOT_FOUND
      _ <- userService.fillSuperUserIdentity(request.identity, organization._id)
      targetUser <- userDAO.findOneByOrgaAndMultiUser(organization._id, request.identity._multiUser)(
        GlobalAccessContext) ?~> "user.notFound" ~> NOT_FOUND
      _ <- Fox.fromBool(!targetUser.isDeactivated) ?~> "user.deactivated"
      result <- Fox.future2Fox(switchToUser(targetUser._id))
      _ <- multiUserDAO.updateLastLoggedInIdentity(request.identity._multiUser, targetUser._id)
    } yield result
  }

  private def switchToUser(targetUserId: ObjectId)(
      implicit request: SecuredRequest[WkEnv, AnyContent]): Future[AuthenticatorResult] =
    for {
      _ <- combinedAuthenticatorService.discard(request.authenticator, Ok) //to logout the admin
      loginInfo = LoginInfo(CredentialsProvider.ID, targetUserId.id)
      authenticator <- combinedAuthenticatorService.create(loginInfo)
      cookie <- combinedAuthenticatorService.init(authenticator)
      result <- combinedAuthenticatorService.embed(cookie, Redirect("/dashboard")) //to login the new user
    } yield result

  def accessibleBySwitching(datasetId: Option[ObjectId],
                            annotationId: Option[String],
                            workflowHash: Option[String]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        selectedOrganization <- authenticationService.getOrganizationToSwitchTo(request.identity,
                                                                                datasetId,
                                                                                annotationId,
                                                                                workflowHash)
        selectedOrganizationJs <- organizationService.publicWrites(selectedOrganization)
      } yield Ok(selectedOrganizationJs)
  }

  def joinOrganization(inviteToken: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      invite <- inviteDAO.findOneByTokenValue(inviteToken) ?~> "invite.invalidToken"
      organization <- organizationDAO.findOne(invite._organization)(GlobalAccessContext) ?~> "invite.invalidToken"
      _ <- userService.assertNotInOrgaYet(request.identity._multiUser, organization._id)
      requestingMultiUser <- multiUserDAO.findOne(request.identity._multiUser)
      _ <- Fox.runIf(!requestingMultiUser.isSuperUser)(
        organizationService
          .assertUsersCanBeAdded(organization._id)(GlobalAccessContext, ec)) ?~> "organization.users.userLimitReached"
      _ <- userService.joinOrganization(request.identity,
                                        organization._id,
                                        autoActivate = invite.autoActivate,
                                        isAdmin = false)
      _ = analyticsService.track(JoinOrganizationEvent(request.identity, organization))
      userEmail <- userService.emailFor(request.identity)
      newUserEmailRecipient <- organizationService.newUserMailRecipient(organization)
      _ = Mailer ! Send(
        defaultMails.registerAdminNotifierMail(request.identity.name,
                                               userEmail,
                                               organization,
                                               invite.autoActivate,
                                               newUserEmailRecipient))
      _ <- inviteService.deactivateUsedInvite(invite)(GlobalAccessContext)
    } yield Ok
  }

  def sendInvites: Action[InviteParameters] = sil.SecuredAction.async(validateJson[InviteParameters]) {
    implicit request =>
      for {
        _ <- Fox.serialCombined(request.body.recipients)(recipient =>
          inviteService.inviteOneRecipient(recipient, request.identity, request.body.autoActivate))
        _ = analyticsService.track(InviteEvent(request.identity, request.body.recipients.length))
        _ = mailchimpClient.tagUser(request.identity, MailchimpTag.HasInvitedTeam)
      } yield Ok
  }

  // If a user has forgotten their password
  def handleStartResetPassword: Action[AnyContent] = Action.async { implicit request =>
    emailForm
      .bindFromRequest()
      .fold(
        bogusForm => Future.successful(BadRequest(bogusForm.toString)),
        email => {
          val userFopt: Future[Option[User]] =
            userService.userFromMultiUserEmail(email.toLowerCase)(GlobalAccessContext).futureBox.map(_.toOption)
          val idF = userFopt.map(userOpt => userOpt.map(_._id.id).getOrElse("")) // do not fail here if there is no user for email. Fail below to unify error handling.
          idF.flatMap(id => userService.retrieve(LoginInfo(CredentialsProvider.ID, id))).flatMap {
            case None => Future.successful(NotFound(Messages("error.noUser")))
            case Some(user) =>
              for {
                token <- bearerTokenAuthenticatorService
                  .createAndInit(user.loginInfo, TokenType.ResetPassword, deleteOld = true)
              } yield {
                Mailer ! Send(defaultMails.resetPasswordMail(user.name, email.toLowerCase, token))
                Ok
              }
          }
        }
      )
  }

  // If a user has forgotten their password
  def handleResetPassword: Action[AnyContent] = Action.async { implicit request =>
    resetPasswordForm
      .bindFromRequest()
      .fold(
        bogusForm => Future.successful(BadRequest(bogusForm.toString)),
        passwords => {
          bearerTokenAuthenticatorService.userForToken(passwords.token.trim).futureBox.flatMap {
            case Full(user) =>
              for {
                _ <- Fox.successful(logger.info(s"Multiuser ${user._multiUser} reset their password."))
                _ <- multiUserDAO.updatePasswordInfo(user._multiUser, passwordHasher.hash(passwords.password1))(
                  GlobalAccessContext)
                _ <- bearerTokenAuthenticatorService.remove(passwords.token.trim)
              } yield Ok
            case _ =>
              Future.successful(BadRequest(Messages("auth.invalidToken")))
          }
        }
      )
  }

  // Users who are logged in can change their password. The old password has to be validated again.
  def changePassword: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    changePasswordForm
      .bindFromRequest()
      .fold(
        bogusForm => Future.successful(BadRequest(bogusForm.toString)),
        passwords => {
          val credentials = Credentials(request.identity._id.id, passwords.oldPassword)
          credentialsProvider
            .authenticate(credentials)
            .flatMap {
              loginInfo =>
                userService.retrieve(loginInfo).flatMap {
                  case None =>
                    Future.successful(NotFound(Messages("error.noUser")))
                  case Some(user) =>
                    for {
                      _ <- Fox.successful(logger.info(s"Multiuser ${user._multiUser} changed their password."))
                      _ <- multiUserDAO.updatePasswordInfo(user._multiUser, passwordHasher.hash(passwords.password1))
                      _ <- Fox.future2Fox(combinedAuthenticatorService.discard(request.authenticator, Ok))
                      userEmail <- userService.emailFor(user)
                    } yield {
                      Mailer ! Send(defaultMails.changePasswordMail(user.name, userEmail))
                      Ok
                    }
                }
            }
            .recover {
              case _: ProviderException => BadRequest(Messages("error.invalidCredentials"))
            }
        }
      )
  }

  def getToken: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      token <- combinedAuthenticatorService.findOrCreateToken(request.identity.loginInfo)
    } yield Ok(Json.obj("token" -> token.id))
  }

  def deleteToken(): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    combinedAuthenticatorService.findTokenByLoginInfo(request.identity.loginInfo).flatMap {
      case Some(token) =>
        combinedAuthenticatorService.discard(token, Ok(Json.obj("messages" -> Messages("auth.tokenDeleted"))))
      case _ => Future.successful(Ok)
    }
  }

  def logout: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    request.authenticator match {
      case Some(authenticator) =>
        for {
          authenticatorResult <- combinedAuthenticatorService.discard(authenticator, Ok)
          _ = logger.info(f"User ${request.identity.map(_._id).getOrElse("id unknown")} logged out.")
        } yield authenticatorResult
      case _ => Future.successful(Ok)
    }
  }

  def singleSignOn(sso: String, sig: String): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    if (ssoKey == "")
      logger.warn("No SSO key configured! To use single-sign-on a sso key needs to be defined in the configuration.")

    request.identity match {
      case Some(user) =>
        // logged in
        // Check if the request we received was signed using our private sso-key
        if (MessageDigest.isEqual(shaHex(ssoKey, sso).getBytes(StandardCharsets.UTF_8),
                                  sig.getBytes(StandardCharsets.UTF_8))) {
          val payload = new String(Base64.decodeBase64(sso))
          val values = play.core.parsers.FormUrlEncodedParser.parse(payload)
          for {
            nonce <- values.get("nonce").flatMap(_.headOption).toFox ?~> "Nonce is missing"
            returnUrl <- values.get("return_sso_url").flatMap(_.headOption).toFox ?~> "Return url is missing"
            userEmail <- userService.emailFor(user)
            _ = logger.info(f"User ${user._id} logged in via SSO.")
          } yield {
            val returnPayload =
              s"nonce=$nonce&" +
                s"email=${URLEncoder.encode(userEmail, "UTF-8")}&" +
                s"external_id=${URLEncoder.encode(user._id.toString, "UTF-8")}&" +
                s"username=${URLEncoder.encode(user.abbreviatedName, "UTF-8")}&" +
                s"name=${URLEncoder.encode(user.name, "UTF-8")}"
            val encodedReturnPayload = Base64.encodeBase64String(returnPayload.getBytes("UTF-8"))
            val returnSignature = shaHex(ssoKey, encodedReturnPayload)
            val query = "sso=" + URLEncoder.encode(encodedReturnPayload, "UTF-8") + "&sig=" + returnSignature
            Redirect(returnUrl + "?" + query)
          }
        } else {
          Fox.successful(BadRequest("Invalid signature"))
        }
      case None => Fox.successful(Redirect("/auth/login?redirectPage=http://discuss.webknossos.org")) // not logged in
    }
  }

  private lazy val absoluteOpenIdConnectCallbackURL = s"${conf.Http.uri}/api/auth/oidc/callback"

  def loginViaOpenIdConnect(): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    if (!isOIDCEnabled) {
      Fox.successful(BadRequest("SSO is not enabled"))
    } else {
      openIdConnectClient
        .getRedirectUrl(absoluteOpenIdConnectCallbackURL)
        .map(url => Ok(Json.obj("redirect_url" -> url)))
    }
  }

  private def loginUser(loginInfo: LoginInfo)(implicit request: Request[AnyContent]): Future[Result] =
    userService.retrieve(loginInfo).flatMap {
      case Some(user) if !user.isDeactivated =>
        for {
          authenticator: CombinedAuthenticator <- combinedAuthenticatorService.create(loginInfo)
          value: Cookie <- combinedAuthenticatorService.init(authenticator)
          result: AuthenticatorResult <- combinedAuthenticatorService.embed(value, Redirect("/dashboard"))
          _ <- multiUserDAO.updateLastLoggedInIdentity(user._multiUser, user._id)(GlobalAccessContext)
          _ = logger.info(f"User ${user._id} logged in.")
          _ = userDAO.updateLastActivity(user._id)(GlobalAccessContext)
        } yield result
      case None =>
        Future.successful(BadRequest(Messages("error.noUser")))
      case Some(_) => Future.successful(BadRequest(Messages("user.deactivated")))
    }

  // Is called after user was successfully authenticated
  private def loginOrSignupViaOidc(
      openIdConnectUserInfo: OpenIdConnectUserInfo): Request[AnyContent] => Future[Result] = {
    implicit request: Request[AnyContent] =>
      userService.userFromMultiUserEmail(openIdConnectUserInfo.email)(GlobalAccessContext).futureBox.flatMap {
        case Full(user) =>
          val loginInfo = LoginInfo("credentials", user._id.toString)
          loginUser(loginInfo)
        case Empty =>
          for {
            organization: Organization <- organizationService.findOneByInviteByIdOrDefault(None, None)(
              GlobalAccessContext)
            user <- createUser(
              organization,
              openIdConnectUserInfo.email,
              openIdConnectUserInfo.given_name,
              openIdConnectUserInfo.family_name,
              autoActivate = true,
              None,
              isEmailVerified = true
            ) // Assuming email verification was done by OIDC provider
            // After registering, also login
            loginInfo = LoginInfo("credentials", user._id.toString)
            loginResult <- Fox.future2Fox(loginUser(loginInfo))
          } yield loginResult
        case _ => Future.successful(InternalServerError)
      }
  }

  def openIdCallback(): Action[AnyContent] = Action.async { implicit request =>
    for {
      _ <- Fox.fromBool(isOIDCEnabled) ?~> "SSO is not enabled"
      (accessToken: JsObject, idToken: Option[JsObject]) <- openIdConnectClient.getAndValidateTokens(
        absoluteOpenIdConnectCallbackURL,
        request.queryString.get("code").flatMap(_.headOption).getOrElse("missing code"),
      ) ?~> "oidc.getToken.failed" ?~> "oidc.authentication.failed"
      userInfoFromTokens <- extractUserInfoFromTokenResponses(accessToken, idToken)
      userResult <- Fox.future2Fox(loginOrSignupViaOidc(userInfoFromTokens)(request))
    } yield userResult
  }

  private def extractUserInfoFromTokenResponses(accessToken: JsObject,
                                                idTokenOpt: Option[JsObject]): Fox[OpenIdConnectUserInfo] = {
    val jsObjectToUse = idTokenOpt.getOrElse(accessToken)
    jsObjectToUse
      .validate[OpenIdConnectUserInfo]
      .asOpt
      .toFox ?~> "Failed to extract user info from id token or access token"
  }

  private def shaHex(key: String, valueToDigest: String): String =
    new HmacUtils(HmacAlgorithms.HMAC_SHA_256, key).hmacHex(valueToDigest)

  def createOrganizationWithAdmin: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    signUpForm
      .bindFromRequest()
      .fold(
        bogusForm => Future.successful(BadRequest(bogusForm.toString)),
        signUpData => {
          organizationService.assertMayCreateOrganization(request.identity).futureBox.flatMap {
            case Full(_) =>
              for {
                (firstName, lastName, email, errors) <- validateNameAndEmail(signUpData.firstName,
                                                                             signUpData.lastName,
                                                                             signUpData.email)
                result <- if (errors.nonEmpty) {
                  Fox.successful(
                    BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t))))))
                } else {
                  for {
                    _ <- initialDataService.insertLocalDataStoreIfEnabled()
                    organization <- organizationService.createOrganization(
                      Option(signUpData.organization).filter(_.trim.nonEmpty),
                      signUpData.organizationName) ?~> "organization.create.failed"
                    user <- userService.insert(
                      organization._id,
                      email,
                      firstName,
                      lastName,
                      isActive = true,
                      passwordHasher.hash(signUpData.password),
                      isAdmin = true,
                      isOrganizationOwner = true,
                      isEmailVerified = false
                    ) ?~> "user.creation.failed"
                    _ = analyticsService.track(SignupEvent(user, hadInvite = false))
                    multiUser <- multiUserDAO.findOne(user._multiUser)
                    dataStoreToken <- bearerTokenAuthenticatorService.createAndInitDataStoreTokenForUser(user)
                    _ <- organizationService
                      .createOrganizationDirectory(organization._id, dataStoreToken) ?~> "organization.folderCreation.failed"
                    _ <- Fox.runIf(conf.WebKnossos.TermsOfService.enabled)(
                      acceptTermsOfServiceForUser(user, signUpData.acceptedTermsOfService))
                  } yield {
                    Mailer ! Send(defaultMails
                      .newOrganizationMail(organization.name, email, request.headers.get("Host").getOrElse("")))
                    if (conf.Features.isWkorgInstance) {
                      mailchimpClient.registerUser(user, multiUser, MailchimpTag.RegisteredAsAdmin)
                    }
                    Ok
                  }
                }
              } yield result
            case _ => Fox.failure(Messages("organization.create.forbidden"))
          }
        }
      )
  }

  private def acceptTermsOfServiceForUser(user: User, termsOfServiceVersion: Option[Int])(
      implicit m: MessagesProvider): Fox[Unit] =
    for {
      acceptedVersion <- termsOfServiceVersion.toFox ?~> "Terms of service must be accepted."
      _ <- organizationService.acceptTermsOfService(user._organization, acceptedVersion)(DBAccessContext(Some(user)), m)
    } yield ()

  case class CreateUserInOrganizationParameters(firstName: String,
                                                lastName: String,
                                                email: String,
                                                password: Option[String],
                                                autoActivate: Option[Boolean])

  object CreateUserInOrganizationParameters {
    implicit val jsonFormat: OFormat[CreateUserInOrganizationParameters] =
      Json.format[CreateUserInOrganizationParameters]
  }

  def createUserInOrganization(organizationId: String): Action[CreateUserInOrganizationParameters] =
    sil.SecuredAction.async(validateJson[CreateUserInOrganizationParameters]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity._multiUser) ?~> "notAllowed" ~> FORBIDDEN
        organization <- organizationDAO.findOne(organizationId) ?~> "organization.notFound"
        (firstName, lastName, email, errors) <- validateNameAndEmail(request.body.firstName,
                                                                     request.body.lastName,
                                                                     request.body.email)
        result <- if (errors.isEmpty) {
          createUser(organization,
                     email,
                     firstName,
                     lastName,
                     request.body.autoActivate.getOrElse(false),
                     request.body.password,
                     Empty).map(u => Ok(u._id.toString))
        } else {
          Fox.successful(BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t))))))
        }
      } yield {
        result
      }
    }

  private def validateNameAndEmail(firstName: String,
                                   lastName: String,
                                   email: String): Fox[(String, String, String, List[String])] = {
    var (errors, fN, lN) = normalizeName(firstName, lastName)
    for {
      nameEmailError: (String, String, String, List[String]) <- Fox
        .future2Fox(multiUserDAO.findOneByEmail(email.toLowerCase)(GlobalAccessContext).futureBox)
        .flatMap {
          case Full(_) =>
            errors ::= "user.email.alreadyInUse"
            Fox.successful(("", "", "", errors))
          case Empty =>
            if (errors.nonEmpty) {
              Fox.successful(("", "", "", errors))
            } else {
              Fox.successful((fN, lN, email.toLowerCase, List()))
            }
          case f: Failure => Fox.failure(f.msg)
        }
    } yield nameEmailError
  }

  private def normalizeName(firstName: String, lastName: String) = {
    var errors = List[String]()
    val fN = TextUtils.normalizeStrong(firstName).getOrElse {
      errors ::= "user.firstName.invalid"
      ""
    }
    val lN = TextUtils.normalizeStrong(lastName).getOrElse {
      errors ::= "user.lastName.invalid"
      ""
    }
    (errors, fN, lN)
  }

}

case class InviteParameters(
    recipients: List[String],
    autoActivate: Boolean
)

object InviteParameters {
  implicit val jsonFormat: Format[InviteParameters] = Json.format[InviteParameters]
}

trait AuthForms {

  private val passwordMinLength = 8

  // Sign up
  case class SignUpData(organization: String,
                        organizationName: String,
                        email: String,
                        firstName: String,
                        lastName: String,
                        password: String,
                        inviteToken: Option[String],
                        acceptedTermsOfService: Option[Int])

  def signUpForm(implicit messages: Messages): Form[SignUpData] =
    Form(
      mapping(
        "organization" -> text,
        "organizationName" -> text,
        "email" -> email,
        "password" -> tuple(
          "password1" -> nonEmptyText.verifying(minLength(passwordMinLength)),
          "password2" -> nonEmptyText
        ).verifying(Messages("error.passwordsDontMatch"), password => password._1 == password._2),
        "firstName" -> nonEmptyText,
        "lastName" -> nonEmptyText,
        "inviteToken" -> optional(nonEmptyText),
        "acceptedTermsOfService" -> optional(number)
      )((organization, organizationName, email, password, firstName, lastName, inviteToken, acceptTos) =>
        SignUpData(organization, organizationName, email, firstName, lastName, password._1, inviteToken, acceptTos))(
        signUpData =>
          Some(
            (signUpData.organization,
             signUpData.organizationName,
             signUpData.email,
             ("", ""),
             signUpData.firstName,
             signUpData.lastName,
             signUpData.inviteToken,
             signUpData.acceptedTermsOfService))))

  // Sign in
  case class SignInData(email: String, password: String)

  val signInForm: Form[SignInData] = Form(
    mapping(
      "email" -> email,
      "password" -> nonEmptyText
    )(SignInData.apply)(SignInData.unapply))

  // Start password recovery
  val emailForm: Form[String] = Form(single("email" -> email))

  // Password recovery
  case class ResetPasswordData(token: String, password1: String, password2: String)

  def resetPasswordForm(implicit messages: Messages): Form[ResetPasswordData] =
    Form(
      mapping(
        "token" -> text,
        "password" -> tuple(
          "password1" -> nonEmptyText.verifying(minLength(passwordMinLength)),
          "password2" -> nonEmptyText
        ).verifying(Messages("error.passwordsDontMatch"), password => password._1 == password._2)
      )((token, password) => ResetPasswordData(token, password._1, password._2))(resetPasswordData =>
        Some(resetPasswordData.token, (resetPasswordData.password1, resetPasswordData.password1))))

  case class ChangePasswordData(oldPassword: String, password1: String, password2: String)

  def changePasswordForm(implicit messages: Messages): Form[ChangePasswordData] =
    Form(
      mapping(
        "oldPassword" -> nonEmptyText,
        "password" -> tuple(
          "password1" -> nonEmptyText.verifying(minLength(passwordMinLength)),
          "password2" -> nonEmptyText
        ).verifying(Messages("error.passwordsDontMatch"), password => password._1 == password._2)
      )((oldPassword, password) => ChangePasswordData(oldPassword, password._1, password._2))(changePasswordData =>
        Some(changePasswordData.oldPassword, (changePasswordData.password1, changePasswordData.password2))))

}
