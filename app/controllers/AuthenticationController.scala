package controllers

import java.net.URLEncoder

import akka.actor.ActorSystem
import com.mohiva.play.silhouette.api.actions.SecuredRequest
import com.mohiva.play.silhouette.api.exceptions.ProviderException
import com.mohiva.play.silhouette.api.services.AuthenticatorResult
import com.mohiva.play.silhouette.api.util.Credentials
import com.mohiva.play.silhouette.api.{LoginInfo, Silhouette}
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import javax.inject.Inject
import models.analytics.{AnalyticsService, InviteEvent, JoinOrganizationEvent, SignupEvent}
import models.annotation.AnnotationState.Cancelled
import models.annotation.{AnnotationDAO, AnnotationIdentifier, AnnotationInformationProvider}
import models.binary.DataSetDAO
import models.organization.{Organization, OrganizationDAO, OrganizationService}
import models.user._
import net.liftweb.common.{Box, Empty, Failure, Full}
import org.apache.commons.codec.binary.Base64
import org.apache.commons.codec.digest.{HmacAlgorithms, HmacUtils}
import oxalis.mail.{DefaultMails, MailchimpClient, MailchimpTag, Send}
import oxalis.security._
import oxalis.thirdparty.BrainTracing
import play.api.data.Form
import play.api.data.Forms.{email, _}
import play.api.data.validation.Constraints._
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.{ObjectId, WkConf}

import scala.concurrent.{ExecutionContext, Future}

class AuthenticationController @Inject()(
    actorSystem: ActorSystem,
    credentialsProvider: CredentialsProvider,
    passwordHasher: PasswordHasher,
    userService: UserService,
    annotationProvider: AnnotationInformationProvider,
    organizationService: OrganizationService,
    inviteService: InviteService,
    inviteDAO: InviteDAO,
    brainTracing: BrainTracing,
    mailchimpClient: MailchimpClient,
    organizationDAO: OrganizationDAO,
    analyticsService: AnalyticsService,
    userDAO: UserDAO,
    dataSetDAO: DataSetDAO,
    multiUserDAO: MultiUserDAO,
    defaultMails: DefaultMails,
    conf: WkConf,
    annotationDAO: AnnotationDAO,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
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

  def register: Action[AnyContent] = Action.async { implicit request =>
    signUpForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      signUpData => {
        val email = signUpData.email.toLowerCase
        var errors = List[String]()
        val firstName = TextUtils.normalizeStrong(signUpData.firstName).getOrElse {
          errors ::= Messages("user.firstName.invalid")
          ""
        }
        val lastName = TextUtils.normalizeStrong(signUpData.lastName).getOrElse {
          errors ::= Messages("user.lastName.invalid")
          ""
        }
        multiUserDAO.findOneByEmail(email)(GlobalAccessContext).toFox.futureBox.flatMap {
          case Full(_) =>
            errors ::= Messages("user.email.alreadyInUse")
            Fox.successful(BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t))))))
          case Empty =>
            if (errors.nonEmpty) {
              Fox.successful(BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t))))))
            } else {
              for {
                inviteBox: Box[Invite] <- inviteService.findInviteByTokenOpt(signUpData.inviteToken).futureBox
                organizationName = Option(signUpData.organization).filter(_.trim.nonEmpty)
                organization <- organizationService.findOneByInviteByNameOrDefault(
                  inviteBox.toOption,
                  organizationName)(GlobalAccessContext) ?~> Messages("organization.notFound", signUpData.organization)
                autoActivate = inviteBox.toOption.map(_.autoActivate).getOrElse(organization.enableAutoVerify)
                user <- userService.insert(organization._id,
                                           email,
                                           firstName,
                                           lastName,
                                           autoActivate,
                                           passwordHasher.hash(signUpData.password)) ?~> "user.creation.failed"
                multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
                _ = analyticsService.track(SignupEvent(user, inviteBox.isDefined))
                _ <- Fox.runOptional(inviteBox.toOption)(i =>
                  inviteService.deactivateUsedInvite(i)(GlobalAccessContext))
                brainDBResult <- brainTracing.registerIfNeeded(user, signUpData.password).toFox
              } yield {
                if (conf.Features.isDemoInstance) {
                  mailchimpClient.registerUser(user, multiUser, tag = MailchimpTag.RegisteredAsUser)
                } else {
                  Mailer ! Send(defaultMails.newUserMail(user.name, email, brainDBResult, autoActivate))
                }
                Mailer ! Send(
                  defaultMails.registerAdminNotifyerMail(user.name, email, brainDBResult, organization, autoActivate))
                Ok
              }
            }
          case f: Failure => Fox.failure(f.msg)
        }
      }
    )
  }

  def authenticate: Action[AnyContent] = Action.async { implicit request =>
    signInForm.bindFromRequest.fold(
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
                    _ <- multiUserDAO.updateLastLoggedInIdentity(user._multiUser, user._id)(GlobalAccessContext)
                    _ = userDAO.updateLastActivity(user._id)(GlobalAccessContext)
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
      _ <- bool2Fox(requestingMultiUser.isSuperUser) ?~> Messages("user.notAuthorised") ~> FORBIDDEN
      targetUser <- userService.userFromMultiUserEmail(email) ?~> "user.notFound" ~> NOT_FOUND
      result <- switchToUser(targetUser._id)
    } yield result
  }

  def switchOrganization(organizationName: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                   organizationName) ~> NOT_FOUND
      _ <- userService.fillSuperUserIdentity(request.identity, organization._id)
      targetUser <- userDAO.findOneByOrgaAndMultiUser(organization._id, request.identity._multiUser)(
        GlobalAccessContext) ?~> "user.notFound" ~> NOT_FOUND
      _ <- bool2Fox(!targetUser.isDeactivated) ?~> "user.deactivated"
      result <- switchToUser(targetUser._id)
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

  /*
    superadmin - can definitely switch, find organization via global access context
    not superadmin - fetch all identities, construct access context, try until one works
   */

  def accessibleBySwitching(organizationName: Option[String],
                            dataSetName: Option[String],
                            annotationId: Option[String]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        isSuperuser <- multiUserDAO.findOne(request.identity._multiUser).map(_.isSuperUser)
        selectedOrganization <- if (isSuperuser)
          accessibleBySwitchingForSuperUser(organizationName, dataSetName, annotationId)
        else
          accessibleBySwitchingForMultiUser(request.identity._multiUser, organizationName, dataSetName, annotationId)
        _ <- bool2Fox(selectedOrganization._id != request.identity._organization) // User is already in correct orga, but still could not see dataset. Assume this had a reason.
        selectedOrganizationJs <- organizationService.publicWrites(selectedOrganization)
      } yield Ok(selectedOrganizationJs)
  }

  private def accessibleBySwitchingForSuperUser(organizationNameOpt: Option[String],
                                                dataSetNameOpt: Option[String],
                                                annotationIdOpt: Option[String]): Fox[Organization] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    (organizationNameOpt, dataSetNameOpt, annotationIdOpt) match {
      case (Some(organizationName), Some(dataSetName), None) =>
        for {
          organization <- organizationDAO.findOneByName(organizationName)
          _ <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id)
        } yield organization
      case (None, None, Some(annotationId)) =>
        for {
          annotationObjectId <- ObjectId.parse(annotationId)
          annotation <- annotationDAO.findOne(annotationObjectId) // Note: this does not work for compound annotations.
          user <- userDAO.findOne(annotation._user)
          organization <- organizationDAO.findOne(user._organization)
        } yield organization
      case _ => Fox.failure("Can either test access for dataset or annotation, not both")
    }
  }

  private def accessibleBySwitchingForMultiUser(multiUserId: ObjectId,
                                                organizationName: Option[String],
                                                dataSetName: Option[String],
                                                annotationId: Option[String]): Fox[Organization] =
    for {
      identities <- userDAO.findAllByMultiUser(multiUserId)
      selectedIdentity <- Fox.find(identities)(identity =>
        canAccessDatasetOrAnnotation(identity, organizationName, dataSetName, annotationId))
      selectedOrganization <- organizationDAO.findOne(selectedIdentity._organization)(GlobalAccessContext)
    } yield selectedOrganization

  private def canAccessDatasetOrAnnotation(user: User,
                                           organizationNameOpt: Option[String],
                                           dataSetNameOpt: Option[String],
                                           annotationIdOpt: Option[String]): Fox[Boolean] = {
    val ctx = AuthorizedAccessContext(user)
    (organizationNameOpt, dataSetNameOpt, annotationIdOpt) match {
      case (Some(organizationName), Some(dataSetName), None) =>
        canAccessDataset(ctx, organizationName, dataSetName)
      case (None, None, Some(annotationId)) =>
        canAccessAnnotation(user, ctx, annotationId)
      case _ => Fox.failure("Can either test access for dataset or annotation, not both")
    }
  }

  private def canAccessDataset(ctx: DBAccessContext, organizationName: String, dataSetName: String): Fox[Boolean] = {
    val foundFox = for {
      organization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext)
      _ <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id)(ctx)
    } yield ()
    foundFox.futureBox.map(_.isDefined)
  }

  private def canAccessAnnotation(user: User, ctx: DBAccessContext, annotationId: String): Fox[Boolean] = {
    val foundFox = for {
      annotationIdParsed <- ObjectId.parse(annotationId)
      annotation <- annotationDAO.findOne(annotationIdParsed)(GlobalAccessContext)
      _ <- bool2Fox(annotation.state != Cancelled)
      restrictions <- annotationProvider.restrictionsFor(AnnotationIdentifier(annotation.typ, annotationIdParsed))(ctx)
      _ <- restrictions.allowAccess(user)
    } yield ()
    foundFox.futureBox.map(_.isDefined)
  }

  def joinOrganization(inviteToken: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      invite <- inviteDAO.findOneByTokenValue(inviteToken) ?~> "invite.invalidToken"
      organization <- organizationDAO.findOne(invite._organization)(GlobalAccessContext) ?~> "invite.invalidToken"
      _ <- userService.assertNotInOrgaYet(request.identity._multiUser, organization._id)
      _ <- userService.joinOrganization(request.identity, organization._id, autoActivate = invite.autoActivate)
      _ = analyticsService.track(JoinOrganizationEvent(request.identity, organization))
      userEmail <- userService.emailFor(request.identity)
      _ = Mailer ! Send(
        defaultMails
          .registerAdminNotifyerMail(request.identity.name, userEmail, None, organization, invite.autoActivate))
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
    emailForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      email => {
        val userFopt: Future[Option[User]] =
          userService.userFromMultiUserEmail(email.toLowerCase)(GlobalAccessContext).futureBox.map(_.toOption)
        val idF = userFopt.map(userOpt => userOpt.map(_._id.id).getOrElse("")) // do not fail here if there is no user for email. Fail below to unify error handling.
        idF.flatMap(id => userService.retrieve(LoginInfo(CredentialsProvider.ID, id))).flatMap {
          case None => Future.successful(NotFound(Messages("error.noUser")))
          case Some(user) =>
            for {
              token <- bearerTokenAuthenticatorService.createAndInit(user.loginInfo, TokenType.ResetPassword)
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
    resetPasswordForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      passwords => {
        bearerTokenAuthenticatorService.userForToken(passwords.token.trim)(GlobalAccessContext).futureBox.flatMap {
          case Full(user) =>
            for {
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
    changePasswordForm.bindFromRequest.fold(
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
                    _ <- multiUserDAO.updatePasswordInfo(user._multiUser, passwordHasher.hash(passwords.password1))
                    _ <- combinedAuthenticatorService.discard(request.authenticator, Ok)
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
      case Some(authenticator) => combinedAuthenticatorService.discard(authenticator, Ok)
      case _                   => Future.successful(Ok)
    }
  }

  def singleSignOn(sso: String, sig: String): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    if (ssoKey == "")
      logger.warn("No SSO key configured! To use single-sign-on a sso key needs to be defined in the configuration.")

    request.identity match {
      case Some(user) =>
        // logged in
        // Check if the request we recieved was signed using our private sso-key
        if (shaHex(ssoKey, sso) == sig) {
          val payload = new String(Base64.decodeBase64(sso))
          val values = play.core.parsers.FormUrlEncodedParser.parse(payload)
          for {
            nonce <- values.get("nonce").flatMap(_.headOption) ?~> "Nonce is missing"
            returnUrl <- values.get("return_sso_url").flatMap(_.headOption) ?~> "Return url is missing"
            userEmail <- userService.emailFor(user)
          } yield {
            val returnPayload =
              s"nonce=$nonce&" +
                s"email=${URLEncoder.encode(userEmail, "UTF-8")}&" +
                s"external_id=${URLEncoder.encode(user._id.toString, "UTF-8")}&" +
                s"username=${URLEncoder.encode(user.abreviatedName, "UTF-8")}&" +
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

  private def shaHex(key: String, valueToDigest: String): String =
    new HmacUtils(HmacAlgorithms.HMAC_SHA_256, key).hmacHex(valueToDigest)

  def createOrganizationWithAdmin: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    signUpForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      signUpData => {
        organizationService.assertMayCreateOrganization(request.identity).futureBox.flatMap {
          case Full(_) =>
            val email = signUpData.email.toLowerCase
            var errors = List[String]()
            val firstName = TextUtils.normalizeStrong(signUpData.firstName).getOrElse {
              errors ::= Messages("user.firstName.invalid")
              ""
            }
            val lastName = TextUtils.normalizeStrong(signUpData.lastName).getOrElse {
              errors ::= Messages("user.lastName.invalid")
              ""
            }
            multiUserDAO.findOneByEmail(email)(GlobalAccessContext).toFox.futureBox.flatMap {
              case Full(_) =>
                errors ::= Messages("user.email.alreadyInUse")
                Fox.successful(BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t))))))
              case Empty =>
                if (errors.nonEmpty) {
                  Fox.successful(
                    BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t))))))
                } else {
                  for {
                    organization <- organizationService.createOrganization(
                      Option(signUpData.organization).filter(_.trim.nonEmpty),
                      signUpData.organizationDisplayName) ?~> "organization.create.failed"
                    user <- userService.insert(organization._id,
                                               email,
                                               firstName,
                                               lastName,
                                               isActive = true,
                                               passwordHasher.hash(signUpData.password),
                                               isAdmin = true) ?~> "user.creation.failed"
                    _ = analyticsService.track(SignupEvent(user, hadInvite = false))
                    multiUser <- multiUserDAO.findOne(user._multiUser)
                    dataStoreToken <- bearerTokenAuthenticatorService
                      .createAndInit(user.loginInfo, TokenType.DataStore, deleteOld = false)
                      .toFox
                    _ <- organizationService
                      .createOrganizationFolder(organization.name, dataStoreToken) ?~> "organization.folderCreation.failed"
                  } yield {
                    Mailer ! Send(
                      defaultMails.newOrganizationMail(organization.displayName,
                                                       email.toLowerCase,
                                                       request.headers.get("Host").getOrElse("")))
                    if (conf.Features.isDemoInstance) {
                      mailchimpClient.registerUser(user, multiUser, MailchimpTag.RegisteredAsAdmin)
                    }
                    Ok
                  }
                }
              case f: Failure => Fox.failure(f.msg)
            }
          case _ => Fox.failure(Messages("organization.create.forbidden"))
        }
      }
    )
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

  val passwordMinLength = 8

  // Sign up
  case class SignUpData(organization: String,
                        organizationDisplayName: String,
                        email: String,
                        firstName: String,
                        lastName: String,
                        password: String,
                        inviteToken: Option[String])

  def signUpForm(implicit messages: Messages): Form[SignUpData] =
    Form(
      mapping(
        "organization" -> text,
        "organizationDisplayName" -> text,
        "email" -> email,
        "password" -> tuple(
          "password1" -> nonEmptyText.verifying(minLength(passwordMinLength)),
          "password2" -> nonEmptyText
        ).verifying(Messages("error.passwordsDontMatch"), password => password._1 == password._2),
        "firstName" -> nonEmptyText,
        "lastName" -> nonEmptyText,
        "inviteToken" -> optional(nonEmptyText),
      )((organization, organizationDisplayName, email, password, firstName, lastName, inviteToken) =>
        SignUpData(organization, organizationDisplayName, email, firstName, lastName, password._1, inviteToken))(
        signUpData =>
          Some(
            (signUpData.organization,
             signUpData.organizationDisplayName,
             signUpData.email,
             ("", ""),
             signUpData.firstName,
             signUpData.lastName,
             signUpData.inviteToken))))

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
