package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper, TextUtils}
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.webauthn4j.data.attestation.statement.COSEAlgorithmIdentifier
import com.webauthn4j.data.client.Origin
import com.webauthn4j.data.client.challenge.Challenge
import com.webauthn4j.data.{
  AuthenticationParameters,
  PublicKeyCredentialParameters,
  PublicKeyCredentialType,
  RegistrationParameters
}
import com.webauthn4j.server.ServerProperty
import com.webauthn4j.WebAuthnManager
import com.webauthn4j.credential.{CredentialRecordImpl => WebAuthnCredentialRecord}
import mail.{DefaultMails, MailchimpClient, MailchimpTag, Send}
import models.analytics.{AnalyticsService, InviteEvent, JoinOrganizationEvent, SignupEvent}
import models.organization.{Organization, OrganizationDAO, OrganizationService}
import models.user._
import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
import com.scalableminds.util.tools.Box.tryo
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
import java.security.SecureRandom
import java.util.UUID
import javax.inject.Inject
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/**
  * Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions
  *
  * Omitted:
  * - `attestation` and `attestationFormat`, because attestation is not implemented.
  * - `extensions` no extensions in use.
  */
case class WebAuthnPublicKeyCredentialCreationOptions(
    authenticatorSelection: WebAuthnCreationOptionsAuthenticatorSelection,
    attestation: String = "none",
    challenge: String,
    excludeCredentials: Array[WebAuthnCreationOptionsExcludeCredentials],
    pubKeyCredParams: Array[WebAuthnCreationOptionsPubKeyParam],
    timeout: Int, // timeout in milliseconds
    rp: WebAuthnCreationOptionsRelyingParty,
    user: WebAuthnCreationOptionsUser
)
object WebAuthnPublicKeyCredentialCreationOptions {
  implicit val jsonFormat: OFormat[WebAuthnPublicKeyCredentialCreationOptions] =
    Json.format[WebAuthnPublicKeyCredentialCreationOptions]
}

/**
  * Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#authenticatorselection
  *
  * Omitted:
  * - `authenticatorAttachment` no forced authenticator.
  * - `userVerifiaction` not implemented on our side.
  * - `hints` no restrictions.
  */
case class WebAuthnCreationOptionsAuthenticatorSelection(
    requireResidentKey: Boolean = true,
    residentKey: String = "required",
    userVerification: String = "preferred"
)
object WebAuthnCreationOptionsAuthenticatorSelection {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsAuthenticatorSelection] =
    Json.format[WebAuthnCreationOptionsAuthenticatorSelection]
}

/**
  * Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#excludecredentials
  *
  * Omitted:
  * - `transports` not restricted by us.
  */
case class WebAuthnCreationOptionsExcludeCredentials(
    id: String,
    `type`: String = "public-key" // must be set to "public-key"
)
object WebAuthnCreationOptionsExcludeCredentials {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsExcludeCredentials] =
    Json.format[WebAuthnCreationOptionsExcludeCredentials]
}

/**
  * Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#pubkeycredparams
  */
case class WebAuthnCreationOptionsPubKeyParam(
    alg: Int,
    `type`: String = "public-key" // must be set to "public-key"
)
object WebAuthnCreationOptionsPubKeyParam {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsPubKeyParam] = Json.format[WebAuthnCreationOptionsPubKeyParam]
}

/**
  * Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#rp
  */
case class WebAuthnCreationOptionsRelyingParty(
    id: String, // Should be set to the hostname
    name: String
)
object WebAuthnCreationOptionsRelyingParty {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsRelyingParty] =
    Json.format[WebAuthnCreationOptionsRelyingParty]
}

case class WebAuthnChallenge(data: Array[Byte]) extends Challenge {
  def getValue() = data
}

/**
  * Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#user
  */
case class WebAuthnCreationOptionsUser(
    displayName: String,
    id: String,
    name: String
)
object WebAuthnCreationOptionsUser {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsUser] = Json.format[WebAuthnCreationOptionsUser]
}

/**
  *  Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialRequestOptions
  *
  *  Omitted:
  *  - allowCredentials: Not necessary, because we use client discoverable credentials
  *  - extensions: Not used
  */
case class WebAuthnPublicKeyCredentialRequestOptions(
    challenge: String,
    timeout: Option[Long] = None, // In milliseconds
    rpId: Option[String] = None, // Relying party ID
    userVerification: Option[String] = Some("preferred"), // "required", "preferred", "discouraged"
    hints: Option[Seq[String]] = None // UI hints for the user-agent
)
object WebAuthnPublicKeyCredentialRequestOptions {
  implicit val jsonFormat: OFormat[WebAuthnPublicKeyCredentialRequestOptions] =
    Json.format[WebAuthnPublicKeyCredentialRequestOptions]
}

/**
  * Custom carrier object. Contains name of the key to register and a key instance of PublicKeyCredentialType
  * (https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredential).
  */
case class WebAuthnRegistration(name: String, key: JsValue)
object WebAuthnRegistration {
  implicit val jsonFormat: OFormat[WebAuthnRegistration] = Json.format[WebAuthnRegistration]
}

/**
  * Wrapper of PublicKeyCredential (https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredential).
  */
case class WebAuthnAuthentication(key: JsValue)
object WebAuthnAuthentication {
  implicit val jsonFormat: OFormat[WebAuthnAuthentication] = Json.format[WebAuthnAuthentication]
}

/**
  * Custom object for WebAuthnCredential's id and name.
  */
case class WebAuthnKeyDescriptor(id: ObjectId, name: String)
object WebAuthnKeyDescriptor {
  implicit val jsonFormat: OFormat[WebAuthnKeyDescriptor] = Json.format[WebAuthnKeyDescriptor]
}

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
    webAuthnCredentialDAO: WebAuthnCredentialDAO,
    temporaryAssertionStore: TemporaryStore[String, WebAuthnChallenge],
    temporaryRegistrationStore: TemporaryStore[String, WebAuthnChallenge],
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with AuthForms
    with FoxImplicits {

  private val combinedAuthenticatorService = wkSilhouetteEnvironment.combinedAuthenticatorService
  private val bearerTokenAuthenticatorService = combinedAuthenticatorService.tokenAuthenticatorService

  private val secureRandom = new SecureRandom()

  private lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  private lazy val ssoKey =
    conf.WebKnossos.User.ssoKey

  private lazy val origin = new Origin(conf.Http.uri)
  private lazy val usesHttps = conf.Http.uri.startsWith("https://")
  private lazy val webAuthnPubKeyParams = Array(
    // COSE Algorithm: EdDSA
    WebAuthnCreationOptionsPubKeyParam(-8, "public-key"),
    // COSE Algorithm: ES256
    WebAuthnCreationOptionsPubKeyParam(-7, "public-key"),
    // COSE Algorithm: RS256
    WebAuthnCreationOptionsPubKeyParam(-257, "public-key"),
  )
  private lazy val webAuthnManager = WebAuthnManager.createNonStrictWebAuthnManager()
  private val webauthnTimeout = 2 minutes

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
                inviteBox <- inviteService.findInviteByTokenOpt(signUpData.inviteToken).shiftBox
                _ <- Fox.fromBool(inviteBox.isDefined || conf.Features.registerToDefaultOrgaEnabled) ?~> "auth.register.needInvite"
                organization <- organizationService.findOneByInviteOrDefault(inviteBox.toOption)(GlobalAccessContext)
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

  private def authenticateInner(loginInfo: LoginInfo)(implicit header: RequestHeader): Future[Result] =
    for {
      result <- userService.retrieve(loginInfo).flatMap {
        case Some(user) if !user.isDeactivated =>
          for {
            authenticator <- combinedAuthenticatorService.create(loginInfo)
            value <- combinedAuthenticatorService.init(authenticator)
            result <- combinedAuthenticatorService.embed(value, Ok)
            _ <- Fox.runIf(conf.WebKnossos.User.EmailVerification.activated)(
              emailVerificationService.assertEmailVerifiedOrResendVerificationMail(user)(GlobalAccessContext, ec))
            _ <- multiUserDAO.updateLastLoggedInIdentity(user._multiUser, user._id)(GlobalAccessContext)
            _ = userDAO.updateLastActivity(user._id)(GlobalAccessContext)
            _ = logger.info(f"User ${user._id} authenticated.")
          } yield result
        case None =>
          Future.successful(BadRequest(Messages("error.noUser")))
        case Some(_) => Future.successful(BadRequest(Messages("user.deactivated")))
      }
    } yield result

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
            .flatMap { loginInfo =>
              authenticateInner(loginInfo)
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
      _ <- Fox.fromBool(requestingMultiUser.isSuperUser) ?~> "user.notAuthorised" ~> FORBIDDEN
      targetUser <- userService.userFromMultiUserEmail(email) ?~> "user.notFound" ~> NOT_FOUND
      result <- Fox.fromFuture(switchToUser(targetUser._id))
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
      result <- Fox.fromFuture(switchToUser(targetUser._id))
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
                            annotationId: Option[ObjectId],
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
      alreadyPayingOrgaForMultiUser <- userDAO.findPayingOrgaIdForMultiUser(requestingMultiUser._id)
      _ <- Fox.runIf(!requestingMultiUser.isSuperUser && alreadyPayingOrgaForMultiUser.isEmpty)(organizationService
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
                      _ <- Fox.fromFuture(combinedAuthenticatorService.discard(request.authenticator, Ok))
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

  def webauthnAuthStart(): Action[AnyContent] = Action.async { implicit request =>
    for {
      _ <- Fox.fromBool(conf.Features.passkeysEnabled) ?~> "auth.passkeys.disabled"
      _ <- Fox.fromBool(usesHttps) ?~> "auth.passkeys.requiresHttps"
      sessionId = UUID.randomUUID().toString
      cookie = Cookie(name = "webauthn-session",
                      value = sessionId,
                      maxAge = Some(webauthnTimeout.toSeconds.toInt),
                      httpOnly = true,
                      secure = true,
                      sameSite = Some(Cookie.SameSite.Strict))
      challenge = new Array[Byte](32)
      _ = secureRandom.nextBytes(challenge)
      assertion = WebAuthnPublicKeyCredentialRequestOptions(
        challenge = Base64.encodeBase64URLSafeString(challenge),
        timeout = Some(webauthnTimeout.toMillis.toInt),
        rpId = Some(origin.getHost),
        userVerification = Some("preferred"),
        hints = None
      )
      _ = temporaryAssertionStore.insert(sessionId, WebAuthnChallenge(challenge), Some(webauthnTimeout))
    } yield Ok(Json.toJson(assertion)).withCookies(cookie)
  }

  def webauthnAuthFinalize(): Action[WebAuthnAuthentication] = Action.async(validateJson[WebAuthnAuthentication]) {
    implicit request =>
      for {
        _ <- Fox.fromBool(conf.Features.passkeysEnabled) ?~> "auth.passkeys.disabled"
        _ <- Fox.fromBool(usesHttps) ?~> "auth.passkeys.requiresHttps"
        cookie <- request.cookies.get("webauthn-session").toFox
        sessionId = cookie.value
        challenge <- temporaryAssertionStore
          .pop(sessionId)
          .toFox ?~> "Timeout during authentication. Please try again." ~> UNAUTHORIZED
        authData <- tryo(webAuthnManager.parseAuthenticationResponseJSON(Json.stringify(request.body.key))).toFox ??~>
          "auth.passkeys.unauthorized" ~> UNAUTHORIZED
        credentialId = authData.getCredentialId
        multiUserId <- ObjectId.fromString(new String(authData.getUserHandle)) ??~>
          "auth.passkeys.unauthorized" ~> UNAUTHORIZED
        multiUser <- multiUserDAO.findOneById(multiUserId)(GlobalAccessContext) ??~>
          "auth.passkeys.unauthorized" ~> UNAUTHORIZED
        credential <- webAuthnCredentialDAO.findByCredentialId(multiUser._id, credentialId)(GlobalAccessContext) ??~>
          "auth.passkeys.unauthorized" ~> UNAUTHORIZED
        serverProperty = new ServerProperty(origin, origin.getHost, challenge)

        params = new AuthenticationParameters(
          serverProperty,
          credential.credentialRecord,
          null,
          false, // User verification is not required put preferred.
          false // User presence is not required.
        )
        _ <- tryo(webAuthnManager.verify(authData, params)).toFox ??~> "auth.passkeys.unauthorized" ~> UNAUTHORIZED
        oldSignCount = credential.credentialRecord.getCounter
        newSignCount = authData.getAuthenticatorData.getSignCount
        _ = credential.credentialRecord.setCounter(newSignCount)
        _ <- webAuthnCredentialDAO.updateSignCount(credential) ??~> "auth.passkeys.unauthorized" ~> UNAUTHORIZED

        // Sign count is 0 if not used by the authenticator.
        _ <- Fox.fromBool((oldSignCount == 0 && newSignCount == 0) || (oldSignCount < newSignCount)) ??~>
          "auth.passkeys.unauthorized" ~> UNAUTHORIZED
        userId <- multiUser._lastLoggedInIdentity.toFox
        loginInfo = LoginInfo("credentials", userId.toString)
        result <- Fox.fromFuture(authenticateInner(loginInfo))
      } yield result
  }

  def webauthnRegisterStart(): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.fromBool(conf.Features.passkeysEnabled) ?~> "auth.passkeys.disabled"
      _ <- Fox.fromBool(usesHttps) ?~> "auth.passkeys.requiresHttps"
      email <- userService.emailFor(request.identity)
      user = WebAuthnCreationOptionsUser(
        displayName = request.identity.name,
        id = Base64.encodeBase64URLSafeString(request.identity._multiUser.toString.getBytes),
        name = email
      )
      credentials <- webAuthnCredentialDAO
        .findAllForUser(request.identity._multiUser) ?~> "Failed to fetch Passkeys" ~> INTERNAL_SERVER_ERROR
      excludeCredentials = credentials
        .map(
          c =>
            WebAuthnCreationOptionsExcludeCredentials(
              id = Base64.encodeBase64URLSafeString(c.credentialRecord.getAttestedCredentialData.getCredentialId)
          ))
        .toArray
      challenge = new Array[Byte](32)
      _ = secureRandom.nextBytes(challenge)
      encodedChallenge = Base64.encodeBase64URLSafeString(challenge)
      sessionId = UUID.randomUUID().toString
      cookie = Cookie("webauthn-registration",
                      sessionId,
                      maxAge = Some(webauthnTimeout.toSeconds.toInt),
                      httpOnly = true,
                      secure = true,
                      sameSite = Some(Cookie.SameSite.Strict))
      _ = temporaryRegistrationStore.insert(sessionId, WebAuthnChallenge(challenge), Some(webauthnTimeout))
      options = WebAuthnPublicKeyCredentialCreationOptions(
        authenticatorSelection = WebAuthnCreationOptionsAuthenticatorSelection(),
        challenge = encodedChallenge,
        excludeCredentials = excludeCredentials,
        pubKeyCredParams = webAuthnPubKeyParams,
        timeout = webauthnTimeout.toMillis.toInt,
        rp = WebAuthnCreationOptionsRelyingParty(
          id = origin.getHost,
          name = origin.getHost,
        ),
        user = user,
      )
    } yield Ok(Json.toJson(options)).withCookies(cookie)
  }

  def webauthnRegisterFinalize(): Action[WebAuthnRegistration] =
    sil.SecuredAction.async(validateJson[WebAuthnRegistration]) { implicit request =>
      for {
        _ <- Fox.fromBool(conf.Features.passkeysEnabled) ?~> "auth.passkeys.disabled"
        _ <- Fox.fromBool(usesHttps) ?~> "auth.passkeys.requiresHttps"
        registrationData <- tryo(webAuthnManager.parseRegistrationResponseJSON(Json.stringify(request.body.key))).toFox
        cookie <- request.cookies.get("webauthn-registration").toFox
        sessionId = cookie.value
        challenge <- temporaryRegistrationStore
          .pop(sessionId)
          .toFox ?~> "Timeout during registration. Please try again." ~> UNAUTHORIZED
        serverProperty = new ServerProperty(origin, origin.getHost, challenge)
        publicKeyParams = webAuthnPubKeyParams.map(k =>
          new PublicKeyCredentialParameters(PublicKeyCredentialType.PUBLIC_KEY, COSEAlgorithmIdentifier.create(k.alg)))
        registrationParams = new RegistrationParameters(serverProperty, publicKeyParams.toList.asJava, false, true)
        _ <- tryo(webAuthnManager.verify(registrationData, registrationParams)).toFox
        attestationObject = registrationData.getAttestationObject
        credentialRecord = new WebAuthnCredentialRecord(
          attestationObject,
          null, // clientData - Client data is not collected.
          null, // clientExtensions - Client extensions are ignored.
          null // transports - All transports are allowed.
        )
        _ = registrationData
        credential = WebAuthnCredential(
          _id = ObjectId.generate,
          _multiUser = request.identity._multiUser,
          name = request.body.name,
          credentialRecord = credentialRecord,
          isDeleted = false
        )
        _ <- webAuthnCredentialDAO.insertOne(credential) ?~> "Failed to add Passkey" ~> INTERNAL_SERVER_ERROR
      } yield Ok(Json.obj("message" -> "Key registered successfully"))
    }

  def webauthnListKeys: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    {
      for {
        _ <- Fox.fromBool(conf.Features.passkeysEnabled) ?~> "auth.passkeys.disabled"
        _ <- Fox.fromBool(usesHttps) ?~> "auth.passkeys.requiresHttps"
        keys <- webAuthnCredentialDAO.findAllForUser(request.identity._multiUser)
        reducedKeys = keys.map(credential => WebAuthnKeyDescriptor(credential._id, credential.name))
      } yield Ok(Json.toJson(reducedKeys))
    }
  }

  def webauthnRemoveKey(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    {
      for {
        _ <- Fox.fromBool(conf.Features.passkeysEnabled) ?~> "auth.passkeys.disabled"
        _ <- Fox.fromBool(usesHttps) ?~> "auth.passkeys.requiresHttps"
        _ <- webAuthnCredentialDAO.removeById(id, request.identity._multiUser) ?~> "Passkey not found" ~> NOT_FOUND
      } yield Ok(Json.obj())
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
            organization: Organization <- organizationService.findOneByInviteOrDefault(None)(GlobalAccessContext)
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
            loginResult <- Fox.fromFuture(loginUser(loginInfo))
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
      userResult <- Fox.fromFuture(loginOrSignupViaOidc(userInfoFromTokens)(request))
    } yield userResult
  }

  private def extractUserInfoFromTokenResponses(accessToken: JsObject,
                                                idTokenOpt: Option[JsObject]): Fox[OpenIdConnectUserInfo] =
    JsonHelper
      .as[OpenIdConnectUserInfo](idTokenOpt.getOrElse(accessToken))
      .toFox ?~> "Failed to extract user info from id token or access token"

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

  private def validateNameAndEmail(firstName: String, lastName: String, email: String)(
      implicit messages: Messages): Fox[(String, String, String, List[String])] = {
    var (errors, fN, lN) = normalizeName(firstName, lastName)
    for {
      nameEmailError: (String, String, String,
      List[String]) <- multiUserDAO.findOneByEmail(email.toLowerCase)(GlobalAccessContext).shiftBox.flatMap {
        case Full(_) =>
          errors ::= Messages("user.email.alreadyInUse")
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

  def logoutEverywhere: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- userDAO.logOutEverywhereByMultiUserId(request.identity._multiUser)
      userIds <- userDAO.findIdsByMultiUserId(request.identity._multiUser)
      _ = userIds.map(userService.removeUserFromCache)
    } yield Ok
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
