package controllers

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, JsonHelper, TextUtils}
import com.scalableminds.util.tools.Fox.toFox
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
import com.webauthn4j.credential.CredentialRecordImpl as WebAuthnCredentialRecord
import mail.{DefaultMails, MailchimpClient, MailchimpTag, Send}
import models.analytics.{AnalyticsService, InviteEvent, JoinOrganizationEvent, SignupEvent}
import models.organization.{Organization, OrganizationDAO, OrganizationService}
import models.user.*
import Box.tryo
import models.team.TeamMembership
import org.apache.commons.codec.binary.Base64
import org.apache.commons.codec.digest.{HmacAlgorithms, HmacUtils}
import org.apache.pekko.actor.ActorSystem
import play.api.data.Form
import play.api.data.Forms.*
import play.api.data.validation.Constraints.*
import play.api.libs.json.*
import play.api.mvc.*
import play.silhouette.api.actions.SecuredRequest
import play.silhouette.api.services.AuthenticatorResult
import play.silhouette.api.util.{Credentials, PasswordInfo}
import play.silhouette.api.{LoginInfo, Silhouette}
import play.silhouette.impl.providers.CredentialsProvider
import security.*
import telemetry.SlackNotificationService
import utils.WkConf

import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import javax.inject.Inject
import scala.concurrent.duration.*
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters.*

/** Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions
  *
  * Omitted:
  *   - `attestation` and `attestationFormat`, because attestation is not implemented.
  *   - `extensions` no extensions in use.
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

/** Object reference:
  * https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#authenticatorselection
  *
  * Omitted:
  *   - `authenticatorAttachment` no forced authenticator.
  *   - `userVerifiaction` not implemented on our side.
  *   - `hints` no restrictions.
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

/** Object reference:
  * https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#excludecredentials
  *
  * Omitted:
  *   - `transports` not restricted by us.
  */
case class WebAuthnCreationOptionsExcludeCredentials(
    id: String,
    `type`: String = "public-key" // must be set to "public-key"
)
object WebAuthnCreationOptionsExcludeCredentials {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsExcludeCredentials] =
    Json.format[WebAuthnCreationOptionsExcludeCredentials]
}

/** Object reference:
  * https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#pubkeycredparams
  */
case class WebAuthnCreationOptionsPubKeyParam(
    alg: Int,
    `type`: String = "public-key" // must be set to "public-key"
)
object WebAuthnCreationOptionsPubKeyParam {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsPubKeyParam] = Json.format[WebAuthnCreationOptionsPubKeyParam]
}

/** Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#rp
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
  def getValue: Array[Byte] = data
}

/** Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#user
  */
case class WebAuthnCreationOptionsUser(
    displayName: String,
    id: String,
    name: String
)
object WebAuthnCreationOptionsUser {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsUser] = Json.format[WebAuthnCreationOptionsUser]
}

/** Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialRequestOptions
  *
  * Omitted:
  *   - allowCredentials: Not necessary, because we use client discoverable credentials
  *   - extensions: Not used
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

/** Custom carrier object. Contains name of the key to register and a key instance of PublicKeyCredentialType
  * (https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredential).
  */
case class WebAuthnRegistration(name: String, key: JsValue)
object WebAuthnRegistration {
  implicit val jsonFormat: OFormat[WebAuthnRegistration] = Json.format[WebAuthnRegistration]
}

/** Wrapper of PublicKeyCredential (https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredential).
  */
case class WebAuthnAuthentication(key: JsValue)
object WebAuthnAuthentication {
  implicit val jsonFormat: OFormat[WebAuthnAuthentication] = Json.format[WebAuthnAuthentication]
}

/** Custom object for WebAuthnCredential's id and name.
  */
case class WebAuthnKeyDescriptor(id: ObjectId, name: String)
object WebAuthnKeyDescriptor {
  implicit val jsonFormat: OFormat[WebAuthnKeyDescriptor] = Json.format[WebAuthnKeyDescriptor]
}

case class CreateOrganizationWithExistingUserParams(userId: ObjectId, newOrganizationName: String)
object CreateOrganizationWithExistingUserParams {
  implicit val jsonFormat: OFormat[CreateOrganizationWithExistingUserParams] =
    Json.format[CreateOrganizationWithExistingUserParams]
}

class AuthenticationController @Inject() (
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
    slackNotificationService: SlackNotificationService,
    tokenDAO: TokenDAO,
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
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with AuthForms {

  private lazy val combinedAuthenticatorService = wkSilhouetteEnvironment.combinedAuthenticatorService
  private lazy val bearerTokenAuthenticatorService = combinedAuthenticatorService.tokenAuthenticatorService
  private lazy val secureRandom = new SecureRandom()
  private lazy val Mailer = actorSystem.actorSelection("/user/mailActor")
  private lazy val ssoKey = conf.WebKnossos.User.ssoKey

  private lazy val origin = new Origin(conf.Http.uri)
  private lazy val usesHttps = conf.Http.uri.startsWith("https://")
  private lazy val webAuthnPubKeyParams = Array(
    // COSE Algorithm: EdDSA
    WebAuthnCreationOptionsPubKeyParam(-8),
    // COSE Algorithm: ES256
    WebAuthnCreationOptionsPubKeyParam(-7),
    // COSE Algorithm: RS256
    WebAuthnCreationOptionsPubKeyParam(-257)
  )
  private lazy val webAuthnManager = WebAuthnManager.createNonStrictWebAuthnManager()
  private val webauthnTimeout = 2 minutes

  private lazy val isOIDCEnabled = conf.Features.openIdConnectEnabled

  def register: Action[AnyContent] = Action.fox { implicit request =>
    signUpForm
      .bindFromRequest()
      .fold(
        bogusForm => Fox.successful(BadRequest(bogusForm.toString)),
        signUpData =>
          if (signUpData.honeypot.exists(_.nonEmpty)) {
            Fox.successful(BadRequest)
          } else {
            for {
              (firstName, lastName, email, errors) <- validateNameAndEmail(
                signUpData.firstName,
                signUpData.lastName,
                signUpData.email
              )
              result <-
                if (errors.nonEmpty) {
                  Fox.successful(
                    BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t)))))
                  )
                } else {
                  for {
                    inviteBox <- inviteService.findInviteByTokenOpt(signUpData.inviteToken).shiftBox
                    _ <- Fox.fromBool(
                      inviteBox.isDefined || conf.Features.registerToDefaultOrgaEnabled
                    ) ?~> Msg.User.needsInvite
                    organization <- organizationService
                      .findOneByInviteOrDefault(inviteBox.toOption)(using GlobalAccessContext)
                    _ <- organizationService.assertUsersCanBeAdded(organization._id)(using
                      GlobalAccessContext,
                      ec
                    ) ?~> Msg.Organization.usersUserLimitReached
                    autoActivate = inviteBox.toOption.map(_.autoActivate).getOrElse(organization.enableAutoVerify)
                    _ = notifyOnSuspiciousNames(organization._id, firstName, lastName)
                    _ <- createUser(
                      organization,
                      email,
                      firstName,
                      lastName,
                      autoActivate,
                      Option(signUpData.password),
                      inviteBox
                    )
                  } yield Ok
                }
            } yield result
          }
      )
  }

  private def createUser(
      organization: Organization,
      email: String,
      firstName: String,
      lastName: String,
      autoActivate: Boolean,
      password: Option[String],
      inviteBox: Box[Invite] = Empty,
      isEmailVerified: Boolean = false
  ): Fox[User] =
    for {
      passwordInfo: PasswordInfo = userService.getPasswordInfo(password)
      teamMemberships <- userService.initialTeamMemberships(
        organization._id,
        inviteIdOpt = inviteBox.map(_._id).toOption
      )
      user <- userService.insert(
        organization._id,
        email,
        firstName,
        lastName,
        autoActivate,
        passwordInfo,
        isAdmin = inviteBox.map(_.isAdmin).getOrElse(false),
        isDatasetManager = inviteBox.map(_.isDatasetManager).getOrElse(false),
        isOrganizationOwner = false,
        isEmailVerified = isEmailVerified,
        teamMemberships = teamMemberships
      ) ?~> Msg.User.createFailed
      multiUser <- multiUserDAO.findOne(user._multiUser)(using GlobalAccessContext)
      _ = analyticsService.track(SignupEvent(user, inviteBox.isDefined))
      _ <- Fox.runIf(inviteBox.isDefined)(
        Fox.runOptional(inviteBox.toOption)(i => inviteService.deactivateUsedInvite(i)(using GlobalAccessContext))
      )
      newUserEmailRecipient <- organizationService.newUserMailRecipient(organization)
      _ =
        if (conf.Features.isWkorgInstance) {
          mailchimpClient.registerUser(user, multiUser, tag = MailchimpTag.RegisteredAsUser)
        } else {
          Mailer ! Send(defaultMails.newUserMail(multiUser.fullName, email, autoActivate))
        }
      _ = Mailer ! Send(
        defaultMails
          .registerAdminNotifierMail(multiUser.fullName, email, organization, autoActivate, newUserEmailRecipient)
      )
    } yield user

  private def authenticateInner(loginInfo: LoginInfo)(implicit header: RequestHeader): Fox[Result] =
    for {
      userOpt <- Fox.fromFuture(userService.retrieve(loginInfo)) ??~> Msg.User.invalidCredentials
      user <- userOpt.toFox ??~> Msg.User.invalidCredentials
      _ <- Fox.fromBool(!user.isDeactivated) ?~> Msg.User.isDeactivated
      authenticator <- Fox.fromFuture(combinedAuthenticatorService.create(loginInfo))
      value <- Fox.fromFuture(combinedAuthenticatorService.init(authenticator))
      resultWithCookie <- Fox.fromFuture(combinedAuthenticatorService.embed(value, Ok))
      _ <- Fox.runIf(conf.WebKnossos.User.EmailVerification.activated)(
        emailVerificationService.assertEmailVerifiedOrResendVerificationMail(user)(using GlobalAccessContext, ec)
      )
      _ <- multiUserDAO.updateLastLoggedInIdentity(user._multiUser, user._id)(using GlobalAccessContext)
      _ = userDAO.updateLastActivity(user._id)(using GlobalAccessContext)
      _ = logger.info(f"User ${user._id} authenticated.")
    } yield resultWithCookie

  def authenticate: Action[AnyContent] = Action.fox { implicit request =>
    signInForm
      .bindFromRequest()
      .fold(
        bogusForm => Fox.failure(bogusForm.toString),
        formValues =>
          for {
            email = formValues.email.toLowerCase
            user <- userService.userFromMultiUserEmail(email)(using
              GlobalAccessContext
            ) ??~> Msg.User.invalidCredentials
            loginInfo <- Fox.fromFuture(
              credentialsProvider.authenticate(Credentials(user._id.toString, formValues.password))
            ) ??~> Msg.User.invalidCredentials
            resultWithCookie <- authenticateInner(loginInfo)
          } yield resultWithCookie
      )
  }

  def switchMultiUser(email: String): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    implicit val ctx: GlobalAccessContext.type = GlobalAccessContext
    for {
      requestingMultiUser <- multiUserDAO.findOne(request.identity._multiUser)
      _ <- Fox.fromBool(requestingMultiUser.isSuperUser) ?~> Msg.User.notAuthenticated ~> FORBIDDEN
      targetUser <- userService.userFromMultiUserEmail(email) ?~> Msg.User.notFound ~> NOT_FOUND
      result <- Fox.fromFuture(switchToUser(targetUser._id))
    } yield result
  }

  def switchOrganization(organizationId: String): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      organization <- organizationDAO.findOne(organizationId) ?~> Msg.Organization.notFound(organizationId) ~> NOT_FOUND
      _ <- userService.fillSuperUserIdentity(request.identity, organization._id)
      targetUser <- userDAO.findOneByOrgaAndMultiUser(organization._id, request.identity._multiUser)(using
        GlobalAccessContext
      ) ?~> Msg.User.notFound ~> NOT_FOUND
      _ <- Fox.fromBool(!targetUser.isDeactivated) ?~> Msg.User.isDeactivated
      result <- Fox.fromFuture(switchToUser(targetUser._id))
      _ <- multiUserDAO.updateLastLoggedInIdentity(request.identity._multiUser, targetUser._id)
    } yield result
  }

  private def switchToUser(
      targetUserId: ObjectId
  )(implicit request: SecuredRequest[WkEnv, AnyContent]): Future[AuthenticatorResult] =
    for {
      _ <- combinedAuthenticatorService.discard(request.authenticator, Ok) // to logout the admin
      loginInfo = LoginInfo(CredentialsProvider.ID, targetUserId.id)
      authenticator <- combinedAuthenticatorService.create(loginInfo)
      cookie <- combinedAuthenticatorService.init(authenticator)
      result <- combinedAuthenticatorService.embed(cookie, Redirect("/dashboard")) // to login the new user
    } yield result

  def accessibleBySwitching(
      datasetId: Option[ObjectId],
      annotationId: Option[ObjectId],
      workflowHash: Option[String]
  ): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      selectedOrganization <- authenticationService.getOrganizationToSwitchTo(
        request.identity,
        datasetId,
        annotationId,
        workflowHash
      )
      selectedOrganizationJs <- organizationService.publicWrites(selectedOrganization)
    } yield Ok(selectedOrganizationJs)
  }

  def joinOrganization(inviteToken: String): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      invite <- inviteDAO.findOneByTokenValue(inviteToken) ?~> Msg.User.invalidInviteToken
      organization <- organizationDAO.findOne(invite._organization)(using
        GlobalAccessContext
      ) ?~> Msg.User.invalidInviteToken
      _ <- userService.assertNotInOrgaYet(request.identity._multiUser, organization._id)
      requestingMultiUser <- multiUserDAO.findOne(request.identity._multiUser)
      alreadyPayingOrgaForMultiUser <- userDAO.findPayingOrgaIdForMultiUser(requestingMultiUser._id)
      _ <- Fox.runIf(!requestingMultiUser.isSuperUser && alreadyPayingOrgaForMultiUser.isEmpty)(
        organizationService.assertUsersCanBeAdded(organization._id)(using GlobalAccessContext, ec)
      ) ?~> Msg.Organization.usersUserLimitReached
      teamMemberships <- userService.initialTeamMemberships(organization._id, Some(invite._id))
      _ <- userService.joinOrganization(
        request.identity,
        organization._id,
        autoActivate = invite.autoActivate,
        isAdmin = invite.isAdmin,
        isDatasetManager = invite.isDatasetManager,
        teamMemberships = teamMemberships
      )
      _ = analyticsService.track(JoinOrganizationEvent(request.identity, organization))
      multiUser <- multiUserDAO.findOne(request.identity._multiUser)
      newUserEmailRecipient <- organizationService.newUserMailRecipient(organization)
      _ = Mailer ! Send(
        defaultMails.registerAdminNotifierMail(
          multiUser.fullName,
          multiUser.email,
          organization,
          invite.autoActivate,
          newUserEmailRecipient
        )
      )
      _ <- inviteService.deactivateUsedInvite(invite)(using GlobalAccessContext)
    } yield Ok
  }

  def sendInvites: Action[InviteParameters] = sil.SecuredAction.fox(validateJson[InviteParameters]) { implicit request =>
    for {
      _ <- validateInvitePermissions(request.identity, request.body)
      senderMultiUser <- multiUserDAO.findOne(request.identity._multiUser)
      _ <- Fox.serialCombined(request.body.recipients)(recipient =>
        inviteService.inviteOneRecipient(
          recipient,
          request.identity,
          senderMultiUser,
          request.body.autoActivate,
          request.body.isAdmin,
          request.body.isDatasetManager,
          request.body.teamMemberships
        )
      )
      _ = analyticsService.track(InviteEvent(request.identity, request.body.recipients.length))
      _ = mailchimpClient.tagUser(request.identity, MailchimpTag.HasInvitedTeam)
    } yield Ok
  }

  private def validateInvitePermissions(requestingUser: User, inviteParameters: InviteParameters): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(inviteParameters.teamMemberships)(teamMembership =>
        Fox.assertTrue(userService.isTeamManagerOrAdminOf(requestingUser, teamMembership.teamId))
      ) ?~> "Can only send invites with team roles for teams you manage."
      _ <- Fox.runIf(inviteParameters.isDatasetManager || inviteParameters.isAdmin)(
        Fox.fromBool(requestingUser.isAdmin)
      ) ?~> "Only admins can send invites that promote new users to admin or dataset manager."
    } yield ()

  // User has forgotten their password and wants a reset link email
  def handleStartResetPassword: Action[AnyContent] = Action.fox { implicit request =>
    emailForm
      .bindFromRequest()
      .fold(
        bogusForm => Fox.failure(bogusForm.toString),
        formEmail =>
          for {
            resultBox <- sendResetPasswordMail(formEmail.toLowerCase).shiftBox
            // We send Ok even if the Box is not Full! This is not to leak existing account info via this route.
          } yield Ok
      )
  }

  private def sendResetPasswordMail(email: String): Fox[Unit] =
    for {
      user <- userService.userFromMultiUserEmail(email)(using GlobalAccessContext)
      multiUser <- multiUserDAO.findOne(user._multiUser)(using GlobalAccessContext)
      resetPasswordToken <- Fox.fromFuture(
        bearerTokenAuthenticatorService.createAndInit(user.loginInfo, TokenType.ResetPassword, deleteOld = true)
      )
      _ = Mailer ! Send(defaultMails.resetPasswordMail(multiUser.fullName, email, resetPasswordToken))
    } yield ()

  // User has forgotten their password and clicked the reset link in the email
  def handleResetPassword: Action[AnyContent] = Action.fox { implicit request =>
    resetPasswordForm
      .bindFromRequest()
      .fold(
        bogusForm => Fox.failure(bogusForm.toString),
        formValues =>
          for {
            user <- bearerTokenAuthenticatorService.userForToken(formValues.token.trim) ?~> Msg.User.Token.invalid
            _ <- multiUserDAO.updatePasswordInfo(
              user._multiUser,
              passwordHasher.hash(formValues.password1)
            )(using GlobalAccessContext)
            _ <- bearerTokenAuthenticatorService.remove(formValues.token.trim)
            _ = logger.info(s"Multiuser ${user._multiUser} reset their password.")
          } yield Ok
      )
  }

  // Users who are logged in can change their password. The old password has to be validated again.
  def changePassword: Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    changePasswordForm
      .bindFromRequest()
      .fold(
        bogusForm => Fox.failure(bogusForm.toString),
        formValues =>
          for {
            credentials = Credentials(request.identity._id.id, formValues.oldPassword)
            loginInfo <- Fox.fromFuture(credentialsProvider.authenticate(credentials)) ?~> Msg.User.invalidCredentials
            userOpt <- Fox.fromFuture(userService.retrieve(loginInfo)) ?~> Msg.User.invalidCredentials
            user <- userOpt.toFox ?~> Msg.User.invalidCredentials
            multiUser <- multiUserDAO.findOne(user._multiUser)
            _ = logger.info(s"Multiuser ${multiUser._id} changed their password.")
            _ <- multiUserDAO.updatePasswordInfo(user._multiUser, passwordHasher.hash(formValues.password1))
            _ <- Fox.fromFuture(combinedAuthenticatorService.discard(request.authenticator, Ok))
            _ = Mailer ! Send(defaultMails.changePasswordMail(multiUser.fullName, multiUser.email))
          } yield Ok
      )
  }

  def getToken: Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      token <- Fox.fromFuture(combinedAuthenticatorService.findOrCreateToken(request.identity.loginInfo))
    } yield Ok(Json.obj("token" -> token.id))
  }

  def deleteToken(): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    Fox.fromFuture(combinedAuthenticatorService.findTokenByLoginInfo(request.identity.loginInfo)).flatMap {
      case Some(token) =>
        Fox.fromFuture(combinedAuthenticatorService.discard(token, Ok(Json.obj("messages" -> Msg.User.Token.deleted))))
      case _ => Fox.successful(Ok)
    }
  }

  def logout: Action[AnyContent] = sil.UserAwareAction.fox { implicit request =>
    val redirectUrlStr: String = conf.SingleSignOn.OpenIdConnect.logoutRedirectUrl.getOrElse("/")
    val rawResultWithRedirect = Ok(Json.toJson(redirectUrlStr))
    request.authenticator match {
      case Some(authenticator) =>
        for {
          authenticatorResult <- Fox.fromFuture(
            combinedAuthenticatorService.discard(authenticator, rawResultWithRedirect)
          )
          _ = logger.info(f"User ${request.identity.map(_._id).getOrElse("id unknown")} logged out.")
        } yield authenticatorResult
      case _ =>
        Fox.successful(rawResultWithRedirect)
    }
  }

  def singleSignOn(sso: String, sig: String): Action[AnyContent] = sil.UserAwareAction.fox { implicit request =>
    if (ssoKey == "")
      logger.warn("No SSO key configured! To use single-sign-on a sso key needs to be defined in the configuration.")

    request.identity match {
      case Some(user) =>
        // logged in
        // Check if the request we received was signed using our private sso-key
        if (
          MessageDigest
            .isEqual(shaHex(ssoKey, sso).getBytes(StandardCharsets.UTF_8), sig.getBytes(StandardCharsets.UTF_8))
        ) {
          val payload = new String(Base64.decodeBase64(sso))
          val values = play.core.parsers.FormUrlEncodedParser.parse(payload)
          for {
            nonce <- values.get("nonce").flatMap(_.headOption).toFox ?~> "Nonce is missing"
            returnUrl <- values.get("return_sso_url").flatMap(_.headOption).toFox ?~> "Return url is missing"
            multiUser <- multiUserDAO.findOne(user._multiUser)
            _ = logger.info(f"User ${user._id} logged in via SSO.")
          } yield {
            val returnPayload =
              s"nonce=$nonce&" +
                s"email=${URLEncoder.encode(multiUser.email, "UTF-8")}&" +
                s"external_id=${URLEncoder.encode(user._id.toString, "UTF-8")}&" +
                s"username=${URLEncoder.encode(multiUser.abbreviatedName, "UTF-8")}&" +
                s"name=${URLEncoder.encode(multiUser.fullName, "UTF-8")}"
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

  def webauthnAuthStart(): Action[AnyContent] = Action.fox { _ =>
    for {
      _ <- Fox.fromBool(conf.Features.passkeysEnabled) ?~> Msg.Passkeys.notEnabled
      _ <- Fox.fromBool(usesHttps) ?~> Msg.Passkeys.requiresHttps
      sessionId = UUID.randomUUID().toString
      cookie = Cookie(
        name = "webauthn-session",
        value = sessionId,
        maxAge = Some(webauthnTimeout.toSeconds.toInt),
        httpOnly = true,
        secure = true,
        sameSite = Some(Cookie.SameSite.Strict)
      )
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

  def webauthnAuthFinalize(): Action[WebAuthnAuthentication] = Action.fox(validateJson[WebAuthnAuthentication]) {
    implicit request =>
      for {
        _ <- Fox.fromBool(conf.Features.passkeysEnabled) ?~> Msg.Passkeys.notEnabled
        _ <- Fox.fromBool(usesHttps) ?~> Msg.Passkeys.requiresHttps
        cookie <- request.cookies.get("webauthn-session").toFox
        sessionId = cookie.value
        challenge <- temporaryAssertionStore
          .pop(sessionId)
          .toFox ?~> "Timeout during authentication. Please try again." ~> UNAUTHORIZED
        authData <- tryo(webAuthnManager.parseAuthenticationResponseJSON(Json.stringify(request.body.key))).toFox ??~>
          Msg.Passkeys.unauthorized ~> UNAUTHORIZED
        credentialId = authData.getCredentialId
        multiUserId <- ObjectId.fromString(new String(authData.getUserHandle)) ??~>
          Msg.Passkeys.unauthorized ~> UNAUTHORIZED
        multiUser <- multiUserDAO.findOneById(multiUserId)(using GlobalAccessContext) ??~>
          Msg.Passkeys.unauthorized ~> UNAUTHORIZED
        credential <- webAuthnCredentialDAO.findByCredentialId(multiUser._id, credentialId)(using
          GlobalAccessContext
        ) ??~>
          Msg.Passkeys.unauthorized ~> UNAUTHORIZED
        serverProperty = ServerProperty.builder().origin(origin).rpId(origin.getHost).challenge(challenge).build()

        params = new AuthenticationParameters(
          serverProperty,
          credential.credentialRecord,
          null,
          false, // User verification is not required put preferred.
          false // User presence is not required.
        )
        _ <- tryo(webAuthnManager.verify(authData, params)).toFox ??~> Msg.Passkeys.unauthorized ~> UNAUTHORIZED
        oldSignCount = credential.credentialRecord.getCounter
        newSignCount = authData.getAuthenticatorData.getSignCount
        _ = credential.credentialRecord.setCounter(newSignCount)
        _ <- webAuthnCredentialDAO.updateSignCount(credential) ??~> Msg.Passkeys.unauthorized ~> UNAUTHORIZED

        // Sign count is 0 if not used by the authenticator.
        _ <- Fox.fromBool((oldSignCount == 0 && newSignCount == 0) || (oldSignCount < newSignCount)) ??~>
          Msg.Passkeys.unauthorized ~> UNAUTHORIZED
        userId <- multiUser._lastLoggedInIdentity.toFox
        loginInfo = LoginInfo("credentials", userId.toString)
        resultWithCookie <- authenticateInner(loginInfo)
      } yield resultWithCookie
  }

  def webauthnRegisterStart(): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- Fox.fromBool(conf.Features.passkeysEnabled) ?~> Msg.Passkeys.notEnabled
      _ <- Fox.fromBool(usesHttps) ?~> Msg.Passkeys.requiresHttps
      multiUser <- multiUserDAO.findOne(request.identity._multiUser)
      user = WebAuthnCreationOptionsUser(
        displayName = multiUser.fullName,
        id = Base64.encodeBase64URLSafeString(multiUser._id.toString.getBytes),
        name = multiUser.email
      )
      credentials <- webAuthnCredentialDAO.findAllForUser(
        request.identity._multiUser
      ) ?~> "Failed to fetch Passkeys" ~> INTERNAL_SERVER_ERROR
      excludeCredentials = credentials
        .map(c =>
          WebAuthnCreationOptionsExcludeCredentials(
            id = Base64.encodeBase64URLSafeString(c.credentialRecord.getAttestedCredentialData.getCredentialId)
          )
        )
        .toArray
      challenge = new Array[Byte](32)
      _ = secureRandom.nextBytes(challenge)
      encodedChallenge = Base64.encodeBase64URLSafeString(challenge)
      sessionId = UUID.randomUUID().toString
      cookie = Cookie(
        "webauthn-registration",
        sessionId,
        maxAge = Some(webauthnTimeout.toSeconds.toInt),
        httpOnly = true,
        secure = true,
        sameSite = Some(Cookie.SameSite.Strict)
      )
      _ = temporaryRegistrationStore.insert(sessionId, WebAuthnChallenge(challenge), Some(webauthnTimeout))
      options = WebAuthnPublicKeyCredentialCreationOptions(
        authenticatorSelection = WebAuthnCreationOptionsAuthenticatorSelection(),
        challenge = encodedChallenge,
        excludeCredentials = excludeCredentials,
        pubKeyCredParams = webAuthnPubKeyParams,
        timeout = webauthnTimeout.toMillis.toInt,
        rp = WebAuthnCreationOptionsRelyingParty(
          id = origin.getHost,
          name = origin.getHost
        ),
        user = user
      )
    } yield Ok(Json.toJson(options)).withCookies(cookie)
  }

  def webauthnRegisterFinalize(): Action[WebAuthnRegistration] =
    sil.SecuredAction.fox(validateJson[WebAuthnRegistration]) { implicit request =>
      for {
        _ <- Fox.fromBool(conf.Features.passkeysEnabled) ?~> Msg.Passkeys.notEnabled
        _ <- Fox.fromBool(usesHttps) ?~> Msg.Passkeys.requiresHttps
        registrationData <- tryo(webAuthnManager.parseRegistrationResponseJSON(Json.stringify(request.body.key))).toFox
        cookie <- request.cookies.get("webauthn-registration").toFox
        sessionId = cookie.value
        challenge <- temporaryRegistrationStore
          .pop(sessionId)
          .toFox ?~> "Timeout during registration. Please try again." ~> UNAUTHORIZED
        serverProperty = ServerProperty.builder().origin(origin).rpId(origin.getHost).challenge(challenge).build()
        publicKeyParams = webAuthnPubKeyParams.map(k =>
          new PublicKeyCredentialParameters(PublicKeyCredentialType.PUBLIC_KEY, COSEAlgorithmIdentifier.create(k.alg))
        )
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

  def webauthnListKeys: Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- Fox.fromBool(conf.Features.passkeysEnabled) ?~> Msg.Passkeys.notEnabled
      _ <- Fox.fromBool(usesHttps) ?~> Msg.Passkeys.requiresHttps
      keys <- webAuthnCredentialDAO.findAllForUser(request.identity._multiUser)
      reducedKeys = keys.map(credential => WebAuthnKeyDescriptor(credential._id, credential.name))
    } yield Ok(Json.toJson(reducedKeys))
  }

  def webauthnRemoveKey(id: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- Fox.fromBool(conf.Features.passkeysEnabled) ?~> Msg.Passkeys.notEnabled
      _ <- Fox.fromBool(usesHttps) ?~> Msg.Passkeys.requiresHttps
      _ <- webAuthnCredentialDAO.removeById(id, request.identity._multiUser) ?~> "Passkey not found" ~> NOT_FOUND
    } yield Ok(Json.obj())
  }

  private lazy val absoluteOpenIdConnectCallbackURL = s"${conf.Http.uri}/api/auth/oidc/callback"

  def loginViaOpenIdConnect(): Action[AnyContent] = sil.UserAwareAction.fox { _ =>
    if (!isOIDCEnabled) {
      Fox.successful(BadRequest("SSO is not enabled"))
    } else {
      openIdConnectClient
        .getRedirectUrl(absoluteOpenIdConnectCallbackURL)
        .map(url => Ok(Json.obj("redirect_url" -> url)))
    }
  }

  private def loginUser(loginInfo: LoginInfo)(implicit request: Request[AnyContent]): Fox[Result] =
    Fox.fromFuture(userService.retrieve(loginInfo)).flatMap {
      case Some(user) if !user.isDeactivated =>
        for {
          authenticator: CombinedAuthenticator <- Fox.fromFuture(combinedAuthenticatorService.create(loginInfo))
          value: Cookie <- Fox.fromFuture(combinedAuthenticatorService.init(authenticator))
          result: AuthenticatorResult <- Fox.fromFuture(
            combinedAuthenticatorService.embed(value, Redirect("/dashboard"))
          )
          _ <- multiUserDAO.updateLastLoggedInIdentity(user._multiUser, user._id)(using GlobalAccessContext)
          _ = logger.info(f"User ${user._id} logged in.")
          _ = userDAO.updateLastActivity(user._id)(using GlobalAccessContext)
        } yield result
      case None =>
        Fox.successful(BadRequest(Msg.User.invalidCredentials))
      case Some(_) => Fox.successful(BadRequest(Msg.User.isDeactivated))
    }

  // Is called after user was successfully authenticated
  private def loginOrSignupViaOidc(
      openIdConnectUserInfo: OpenIdConnectUserInfo
  ): Request[AnyContent] => Fox[Result] = { implicit request: Request[AnyContent] =>
    userService.userFromMultiUserEmail(openIdConnectUserInfo.email)(using GlobalAccessContext).shiftBox.flatMap {
      case Full(user) =>
        val loginInfo = LoginInfo("credentials", user._id.toString)
        loginUser(loginInfo)
      case Empty =>
        for {
          organization: Organization <- organizationService.findOneByInviteOrDefault(None)(using GlobalAccessContext)
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
          loginResult <- loginUser(loginInfo)
        } yield loginResult
      case _ => Fox.successful(InternalServerError)
    }
  }

  def openIdCallback(): Action[AnyContent] = Action.fox { implicit request =>
    for {
      _ <- Fox.fromBool(isOIDCEnabled) ?~> "SSO is not enabled"
      (accessToken: JsObject, idToken: Option[JsObject]) <- openIdConnectClient.getAndValidateTokens(
        absoluteOpenIdConnectCallbackURL,
        request.queryString.get("code").flatMap(_.headOption).getOrElse("missing code")
      ) ?~> Msg.Oidc.getTokenFailed ?~> Msg.Oidc.authenticationFailed
      userInfoFromTokens <- extractUserInfoFromTokenResponses(accessToken, idToken)
      userResult <- loginOrSignupViaOidc(userInfoFromTokens)(request)
    } yield userResult
  }

  private def extractUserInfoFromTokenResponses(
      accessToken: JsObject,
      idTokenOpt: Option[JsObject]
  ): Fox[OpenIdConnectUserInfo] =
    JsonHelper
      .as[OpenIdConnectUserInfo](idTokenOpt.getOrElse(accessToken))
      .toFox ?~> "Failed to extract user info from id token or access token"

  private def shaHex(key: String, valueToDigest: String): String =
    new HmacUtils(HmacAlgorithms.HMAC_SHA_256, key).hmacHex(valueToDigest)

  def createOrganizationWithExistingUser: Action[CreateOrganizationWithExistingUserParams] =
    sil.SecuredAction.fox(validateJson[CreateOrganizationWithExistingUserParams]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        user <- userDAO.findOne(request.body.userId)(using GlobalAccessContext)
        newOrganizationId = RandomIDGenerator.generateBlocking(8, useHex = true)
        organization <- organizationService.createOrganization(
          Some(newOrganizationId),
          request.body.newOrganizationName
        )
        _ <- organizationService.createOrganizationDirectory(
          organization._id
        ) ?~> Msg.Organization.Create.directoryCreateFailed
        teamMemberships <- userService.initialTeamMemberships(organization._id, None)
        _ <- userService.joinOrganization(
          user,
          organization._id,
          autoActivate = true,
          isAdmin = true,
          isDatasetManager = false,
          isOrganizationOwner = true,
          teamMemberships = teamMemberships
        )
        _ = analyticsService.track(JoinOrganizationEvent(user, organization))
      } yield Ok(Json.toJson(organization._id))
    }

  def createOrganizationWithAdmin: Action[AnyContent] = sil.UserAwareAction.fox { implicit request =>
    signUpForm
      .bindFromRequest()
      .fold(
        bogusForm => Fox.successful(BadRequest(bogusForm.toString)),
        signUpData =>
          if (signUpData.honeypot.exists(_.nonEmpty)) {
            Fox.successful(BadRequest)
          } else {
            organizationService.assertMayCreateOrganization(request.identity).shiftBox.flatMap {
              case Full(_) =>
                for {
                  (firstName, lastName, email, errors) <- validateNameAndEmail(
                    signUpData.firstName,
                    signUpData.lastName,
                    signUpData.email
                  )
                  result <-
                    if (errors.nonEmpty) {
                      Fox.successful(
                        BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t)))))
                      )
                    } else {
                      for {
                        _ <- initialDataService.insertLocalDataStoreIfEnabled()
                        organization <- organizationService.createOrganization(
                          Option(signUpData.organization).filter(_.trim.nonEmpty),
                          signUpData.organizationName
                        ) ?~> Msg.Organization.Create.failed
                        teamMemberships <- userService.initialTeamMemberships(organization._id, inviteIdOpt = None)
                        _ = notifyOnSuspiciousNames(organization._id, firstName, lastName)
                        user <- userService.insert(
                          organization._id,
                          email,
                          firstName,
                          lastName,
                          isActive = true,
                          passwordHasher.hash(signUpData.password),
                          isAdmin = true,
                          isDatasetManager = false,
                          isOrganizationOwner = true,
                          isEmailVerified = false,
                          teamMemberships = teamMemberships
                        ) ?~> Msg.User.createFailed
                        _ = analyticsService.track(SignupEvent(user, hadInvite = false))
                        multiUser <- multiUserDAO.findOne(user._multiUser)(using GlobalAccessContext)
                        _ <- organizationService.createOrganizationDirectory(
                          organization._id
                        ) ?~> Msg.Organization.Create.directoryCreateFailed
                        _ <- Fox.runIf(conf.WebKnossos.TermsOfService.enabled)(
                          acceptTermsOfServiceForUser(user, signUpData.acceptedTermsOfService)
                        )
                        _ = Mailer ! Send(
                          defaultMails
                            .newOrganizationMail(organization.name, email, request.headers.get("Host").getOrElse(""))
                        )
                        _ = if (conf.Features.isWkorgInstance) {
                          mailchimpClient.registerUser(user, multiUser, MailchimpTag.RegisteredAsAdmin)
                        }
                      } yield Ok
                    }
                } yield result
              case _ => Fox.failure(Msg.Organization.Create.forbidden)
            }
          }
      )
  }

  private def acceptTermsOfServiceForUser(user: User, termsOfServiceVersion: Option[Int]): Fox[Unit] =
    for {
      acceptedVersion <- termsOfServiceVersion.toFox ?~> "Terms of service must be accepted."
      _ <- organizationService.acceptTermsOfService(user._organization, acceptedVersion)(using
        DBAccessContext(Some(user))
      )
    } yield ()

  case class CreateUserInOrganizationParameters(
      firstName: String,
      lastName: String,
      email: String,
      password: Option[String],
      autoActivate: Option[Boolean]
  )

  object CreateUserInOrganizationParameters {
    implicit val jsonFormat: OFormat[CreateUserInOrganizationParameters] =
      Json.format[CreateUserInOrganizationParameters]
  }

  def createUserInOrganization(organizationId: String): Action[CreateUserInOrganizationParameters] =
    sil.SecuredAction.fox(validateJson[CreateUserInOrganizationParameters]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity._multiUser) ?~> Msg.notAllowed ~> FORBIDDEN
        organization <- organizationDAO.findOne(organizationId) ?~> Msg.Organization.notFound(organizationId)
        (firstName, lastName, email, errors) <- validateNameAndEmail(
          request.body.firstName,
          request.body.lastName,
          request.body.email
        )
        result <-
          if (errors.isEmpty) {
            createUser(
              organization,
              email,
              firstName,
              lastName,
              request.body.autoActivate.getOrElse(false),
              request.body.password,
              Empty
            ).map(u => Ok(u._id.toString))
          } else {
            Fox.successful(BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t))))))
          }
      } yield result
    }

  private def validateNameAndEmail(
      firstName: String,
      lastName: String,
      email: String
  ): Fox[(String, String, String, List[String])] = {
    var (errors, fN, lN) = normalizeName(firstName, lastName)
    for {
      nameEmailError: (String, String, String, List[String]) <- multiUserDAO
        .findOneByEmail(email.toLowerCase)(using GlobalAccessContext)
        .shiftBox
        .flatMap {
          case Full(_) =>
            errors ::= Msg.User.Email.taken
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
      errors ::= Msg.User.invalidFirstName
      ""
    }
    val lN = TextUtils.normalizeStrong(lastName).getOrElse {
      errors ::= Msg.User.invalidLastName
      ""
    }
    (errors, fN, lN)
  }

  private def notifyOnSuspiciousNames(organizationId: String, firstName: String, lastName: String): Unit = {
    val suspiciousNameEntropyThreshold = 3.0
    val suspiciousNameMinLength = 6

    def shannonEntropy(s: String): Double =
      if (s.isEmpty) 0.0
      else {
        val frequencies = s.groupBy(identity).values.map(_.length.toDouble / s.length)
        -frequencies.map(p => p * (math.log(p) / math.log(2))).sum
      }

    val isSuspicious = List(firstName, lastName).exists(name =>
      name.length >= suspiciousNameMinLength && shannonEntropy(name) >= suspiciousNameEntropyThreshold
    )

    if (isSuspicious) {
      val msg =
        s"High-entropy name detected during registration: $firstName $lastName (organizationId $organizationId)"
      logger.warn(msg)
      slackNotificationService.warn("Registration with suspicious name", msg)
    }
  }

  def logoutEverywhere: Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- userDAO.logOutEverywhereByMultiUserId(request.identity._multiUser)
      userIds <- userDAO.findIdsByMultiUserId(request.identity._multiUser)
      _ = userIds.map(userService.removeUserFromCache)
      _ <- tokenDAO.deleteDataStoreTokensForMultiUser(request.identity._multiUser)
    } yield Ok
  }
}

case class InviteParameters(
    recipients: Seq[String],
    autoActivate: Boolean,
    isAdmin: Boolean,
    isDatasetManager: Boolean,
    teamMemberships: Seq[TeamMembership]
)

object InviteParameters {
  implicit val jsonReads: Reads[InviteParameters] = Json.reads[InviteParameters]
}

trait AuthForms {

  private val passwordMinLength = 8

  // Sign up
  case class SignUpData(
      organization: String,
      organizationName: String,
      email: String,
      firstName: String,
      lastName: String,
      password: String,
      inviteToken: Option[String],
      acceptedTermsOfService: Option[Int],
      honeypot: Option[String]
  )

  def signUpForm: Form[SignUpData] =
    Form(
      mapping(
        "organization" -> text,
        "organizationName" -> text,
        "email" -> email,
        "password" -> tuple(
          "password1" -> nonEmptyText.verifying(minLength(passwordMinLength)),
          "password2" -> nonEmptyText
        ).verifying(Msg.User.passwordsDontMatch, password => password._1 == password._2),
        "firstName" -> nonEmptyText,
        "lastName" -> nonEmptyText,
        "inviteToken" -> optional(nonEmptyText),
        "acceptedTermsOfService" -> optional(number),
        "referral" -> optional(text) // honeypot field
      )((organization, organizationName, email, password, firstName, lastName, inviteToken, acceptTos, honeypot) =>
        SignUpData(
          organization,
          organizationName,
          email,
          firstName,
          lastName,
          password._1,
          inviteToken,
          acceptTos,
          honeypot
        )
      )(signUpData =>
        Some(
          (
            signUpData.organization,
            signUpData.organizationName,
            signUpData.email,
            ("", ""),
            signUpData.firstName,
            signUpData.lastName,
            signUpData.inviteToken,
            signUpData.acceptedTermsOfService,
            signUpData.honeypot
          )
        )
      )
    )

  // Sign in
  case class SignInData(email: String, password: String)

  val signInForm: Form[SignInData] = Form(
    mapping(
      "email" -> email,
      "password" -> nonEmptyText
    )(SignInData.apply)(signinData => Some(signinData.email, signinData.password))
  )

  // Start password recovery
  val emailForm: Form[String] = Form(single("email" -> email))

  // Password recovery
  case class ResetPasswordData(token: String, password1: String, password2: String)

  def resetPasswordForm: Form[ResetPasswordData] =
    Form(
      mapping(
        "token" -> text,
        "password" -> tuple(
          "password1" -> nonEmptyText.verifying(minLength(passwordMinLength)),
          "password2" -> nonEmptyText
        ).verifying(Msg.User.passwordsDontMatch, password => password._1 == password._2)
      )((token, password) => ResetPasswordData(token, password._1, password._2))(resetPasswordData =>
        Some(resetPasswordData.token, (resetPasswordData.password1, resetPasswordData.password1))
      )
    )

  case class ChangePasswordData(oldPassword: String, password1: String, password2: String)

  def changePasswordForm: Form[ChangePasswordData] =
    Form(
      mapping(
        "oldPassword" -> nonEmptyText,
        "password" -> tuple(
          "password1" -> nonEmptyText.verifying(minLength(passwordMinLength)),
          "password2" -> nonEmptyText
        ).verifying(Msg.User.passwordsDontMatch, password => password._1 == password._2)
      )((oldPassword, password) => ChangePasswordData(oldPassword, password._1, password._2))(changePasswordData =>
        Some(changePasswordData.oldPassword, (changePasswordData.password1, changePasswordData.password2))
      )
    )

}
