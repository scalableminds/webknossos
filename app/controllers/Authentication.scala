package controllers

import akka.actor.ActorSystem
import com.mohiva.play.silhouette.api.exceptions.ProviderException
import com.mohiva.play.silhouette.api.util.Credentials
import com.mohiva.play.silhouette.api.{LoginInfo, Silhouette}
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.mail._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.rpc.RPC
import models.binary.{DataStore, DataStoreDAO}
import models.team._
import models.user._
import net.liftweb.common.{Empty, Failure, Full}
import org.apache.commons.codec.binary.Base64
import org.apache.commons.codec.digest.HmacUtils
import oxalis.mail.DefaultMails
import oxalis.security._
import oxalis.thirdparty.BrainTracing
import play.api.data.Form
import play.api.data.Forms.{email, _}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import play.api.data.validation.Constraints._
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.mvc._
import utils.{ObjectId, WkConf}
import java.net.URLEncoder

import com.mohiva.play.silhouette.api.actions.SecuredRequest
import com.mohiva.play.silhouette.api.services.AuthenticatorResult
import javax.inject.Inject

import scala.concurrent.{ExecutionContext, Future}

object AuthForms {

  val passwordMinLength = 8

  // Sign up
  case class SignUpData(organization: String,
                        organizationDisplayName: String,
                        email: String,
                        firstName: String,
                        lastName: String,
                        password: String,
                        inviteToken: Option[String])

  def signUpForm(implicit messages: Messages) =
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

  val signInForm = Form(
    mapping(
      "email" -> email,
      "password" -> nonEmptyText
    )(SignInData.apply)(SignInData.unapply))

  // Start password recovery
  val emailForm = Form(single("email" -> email))

  // Password recovery
  case class ResetPasswordData(token: String, password1: String, password2: String)

  def resetPasswordForm(implicit messages: Messages) =
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

  def changePasswordForm(implicit messages: Messages) =
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

class Authentication @Inject()(actorSystem: ActorSystem,
                               credentialsProvider: CredentialsProvider,
                               passwordHasher: PasswordHasher,
                               initialDataService: InitialDataService,
                               userService: UserService,
                               dataStoreDAO: DataStoreDAO,
                               teamDAO: TeamDAO,
                               inviteService: InviteService,
                               brainTracing: BrainTracing,
                               organizationDAO: OrganizationDAO,
                               userDAO: UserDAO,
                               multiUserDAO: MultiUserDAO,
                               defaultMails: DefaultMails,
                               rpc: RPC,
                               conf: WkConf,
                               wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  import AuthForms._

  val combinedAuthenticatorService = wkSilhouetteEnvironment.combinedAuthenticatorService
  val bearerTokenAuthenticatorService = combinedAuthenticatorService.tokenAuthenticatorService

  private lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  private lazy val ssoKey =
    conf.Application.Authentication.ssoKey

  def normalizeName(name: String): Option[String] = {
    val replacementMap = Map(
      "ü" -> "ue",
      "Ü" -> "Ue",
      "ö" -> "oe",
      "Ö" -> "Oe",
      "ä" -> "ae",
      "Ä" -> "Ae",
      "ß" -> "ss",
      "é" -> "e",
      "è" -> "e",
      "ê" -> "e",
      "È" -> "E",
      "É" -> "E",
      "Ê" -> "E",
      "Ç" -> "C",
      "ç" -> "c",
      "ñ" -> "n",
      "Ñ" -> "N",
      "ë" -> "e",
      "Ë" -> "E",
      "ï" -> "i",
      "Ï" -> "I",
      "å" -> "a",
      "Å" -> "A",
      "œ" -> "oe",
      "Œ" -> "Oe",
      "æ" -> "ae",
      "Æ" -> "Ae",
      "þ" -> "th",
      "Þ" -> "Th",
      "ø" -> "oe",
      "Ø" -> "Oe",
      "í" -> "i",
      "ì" -> "i"
    )

    val finalName =
      name.map(c => replacementMap.getOrElse(c.toString, c.toString)).mkString.replaceAll("[^A-Za-z0-9_\\-\\s]", "")
    if (finalName.isEmpty)
      None
    else
      Some(finalName)
  }

  def handleRegistration: Action[AnyContent] = Action.async { implicit request =>
    signUpForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      signUpData => {
        val email = signUpData.email.toLowerCase
        var errors = List[String]()
        val firstName = normalizeName(signUpData.firstName).getOrElse {
          errors ::= Messages("user.firstName.invalid")
          ""
        }
        val lastName = normalizeName(signUpData.lastName).getOrElse {
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
                organization <- organizationDAO
                  .findOneByName(signUpData.organization)(GlobalAccessContext) ?~> Messages("organization.notFound",
                                                                                            signUpData.organization)
                user <- userService.insert(organization._id,
                                           email,
                                           firstName,
                                           lastName,
                                           organization.enableAutoVerify,
                                           false,
                                           passwordHasher.hash(signUpData.password)) ?~> "user.creation.failed"
                brainDBResult <- brainTracing.registerIfNeeded(user, signUpData.password).toFox
              } yield {
                if (conf.Features.isDemoInstance) {
                  Mailer ! Send(defaultMails.newUserWKOrgMail(user.name, email, organization.enableAutoVerify))
                } else {
                  Mailer ! Send(
                    defaultMails.newUserMail(user.name, email, brainDBResult, organization.enableAutoVerify))
                }
                Mailer ! Send(defaultMails.registerAdminNotifyerMail(user.name, email, brainDBResult, organization))
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
                case Some(user) if (!user.isDeactivated) =>
                  for {
                    authenticator <- combinedAuthenticatorService.create(loginInfo)
                    value <- combinedAuthenticatorService.init(authenticator)
                    result <- combinedAuthenticatorService.embed(value, Ok)
                    _ <- multiUserDAO.updateLastLoggedInIdentity(user._multiUser, user._id)(GlobalAccessContext)
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

  def joinOrganization(organizationName: String, inviteToken: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        organiaztion <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext)
        _ <- inviteService.assertValidInvite(inviteToken, organiaztion._id) ?~> "invite.invalidToken"
        _ <- userService.assertNotInOrgaYet(request.identity._multiUser, organiaztion._id)
        _ <- userService.joinOrganization(request.identity, organiaztion._id)
      } yield Ok
  }

  def sendInvites: Action[InviteParameters] = sil.SecuredAction.async(validateJson[InviteParameters]) {
    implicit request =>
      for {
        _ <- Fox.serialCombined(request.body.recipients)(recipient =>
          inviteService.inviteOneRecipient(recipient, request.identity, request.body.autoActivate))
      } yield Ok
  }

  // If a user has forgotten their password
  def handleStartResetPassword = Action.async { implicit request =>
    emailForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      email =>
        userService.retrieve(LoginInfo(CredentialsProvider.ID, email.toLowerCase)).flatMap {
          case None => Future.successful(NotFound(Messages("error.noUser")))
          case Some(user) => {
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
  def handleResetPassword = Action.async { implicit request =>
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
  def changePassword = sil.SecuredAction.async { implicit request =>
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
            case e: ProviderException => BadRequest(Messages("error.invalidCredentials"))
          }
      }
    )
  }

  def getToken = sil.SecuredAction.async { implicit request =>
    val futureOfFuture: Future[Future[Result]] =
      combinedAuthenticatorService.findByLoginInfo(request.identity.loginInfo).map {
        case Some(token) => Future.successful(Ok(Json.obj("token" -> token.id)))
        case _ =>
          combinedAuthenticatorService.createToken(request.identity.loginInfo).map { newToken =>
            Ok(Json.obj("token" -> newToken.id))
          }
      }
    for {
      resultFuture <- futureOfFuture
      result <- resultFuture
    } yield result
  }

  def deleteToken = sil.SecuredAction.async { implicit request =>
    val futureOfFuture: Future[Future[Result]] =
      combinedAuthenticatorService.findByLoginInfo(request.identity.loginInfo).map {
        case Some(token) =>
          combinedAuthenticatorService.discard(token, Ok(Json.obj("messages" -> Messages("auth.tokenDeleted"))))
        case _ => Future.successful(Ok)
      }

    for {
      resultFuture <- futureOfFuture
      result <- resultFuture
    } yield result
  }

  def logout = sil.UserAwareAction.async { implicit request =>
    request.authenticator match {
      case Some(authenticator) => combinedAuthenticatorService.discard(authenticator, Ok)
      case _                   => Future.successful(Ok)
    }
  }

  def singleSignOn(sso: String, sig: String) = sil.UserAwareAction.async { implicit request =>
    if (ssoKey == "")
      logger.warn("No SSO key configured! To use single-sign-on a sso key needs to be defined in the configuration.")

    request.identity match {
      case Some(user) =>
        // logged in
        // Check if the request we recieved was signed using our private sso-key
        if (HmacUtils.hmacSha256Hex(ssoKey, sso) == sig) {
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
            val returnSignature = HmacUtils.hmacSha256Hex(ssoKey, encodedReturnPayload)
            val query = "sso=" + URLEncoder.encode(encodedReturnPayload, "UTF-8") + "&sig=" + returnSignature
            Redirect(returnUrl + "?" + query)
          }
        } else {
          Fox.successful(BadRequest("Invalid signature"))
        }
      case None => Fox.successful(Redirect("/auth/login?redirectPage=http://discuss.webknossos.org")) // not logged in
    }

  }

  def createOrganizationWithAdmin = sil.UserAwareAction.async { implicit request =>
    signUpForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      signUpData => {
        creatingOrganizationsIsAllowed(request.identity).futureBox.flatMap {
          case Full(_) =>
            val email = signUpData.email.toLowerCase
            val loginInfo = LoginInfo(CredentialsProvider.ID, email)
            var errors = List[String]()
            val firstName = normalizeName(signUpData.firstName).getOrElse {
              errors ::= Messages("user.firstName.invalid")
              ""
            }
            val lastName = normalizeName(signUpData.lastName).getOrElse {
              errors ::= Messages("user.lastName.invalid")
              ""
            }
            userService.retrieve(loginInfo).toFox.futureBox.flatMap {
              case Full(_) =>
                errors ::= Messages("user.email.alreadyInUse")
                Fox.successful(BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t))))))
              case Empty =>
                if (errors.nonEmpty) {
                  Fox.successful(
                    BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t))))))
                } else {
                  for {
                    organization <- createOrganization(
                      Option(signUpData.organization).filter(_.trim.nonEmpty),
                      signUpData.organizationDisplayName) ?~> "organization.create.failed"
                    user <- userService.insert(organization._id,
                                               email,
                                               firstName,
                                               lastName,
                                               isActive = true,
                                               isOrgTeamManager = true,
                                               passwordHasher.hash(signUpData.password),
                                               isAdmin = true) ?~> "user.creation.failed"
                    _ <- createOrganizationFolder(organization.name, loginInfo) ?~> "organization.folderCreation.failed"
                  } yield {
                    Mailer ! Send(
                      defaultMails.newOrganizationMail(organization.displayName,
                                                       email.toLowerCase,
                                                       request.headers.get("Host").getOrElse("")))
                    if (conf.Features.isDemoInstance) {
                      Mailer ! Send(defaultMails.newAdminWKOrgMail(user.firstName, email))
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

  private def creatingOrganizationsIsAllowed(requestingUser: Option[User]): Fox[Unit] = {
    val noOrganizationPresent = initialDataService.assertNoOrganizationsPresent
    val activatedInConfig = bool2Fox(conf.Features.isDemoInstance) ?~> "allowOrganizationCreation.notEnabled"
    val userIsSuperUser = requestingUser.toFox.flatMap(user =>
      multiUserDAO.findOne(user._multiUser)(GlobalAccessContext).flatMap(multiUser => bool2Fox(multiUser.isSuperUser)))

    Fox.sequenceOfFulls[Unit](List(noOrganizationPresent, activatedInConfig, userIsSuperUser)).map(_.headOption).toFox
  }

  private def createOrganization(organizationNameOpt: Option[String], organizationDisplayName: String) =
    for {
      normalizedDisplayName <- normalizeName(organizationDisplayName).toFox ?~> "organization.name.invalid"
      organizationName = organizationNameOpt
        .flatMap(normalizeName)
        .getOrElse(normalizedDisplayName)
        .replaceAll(" ", "_")
      existingOrganization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext).futureBox
      _ <- bool2Fox(existingOrganization.isEmpty) ?~> "organization.name.alreadyInUse"
      organization = Organization(ObjectId.generate, organizationName, "", "", organizationDisplayName)
      organizationTeam = Team(ObjectId.generate, organization._id, "Default", isOrganizationTeam = true)
      _ <- organizationDAO.insertOne(organization)(GlobalAccessContext)
      _ <- teamDAO.insertOne(organizationTeam)(GlobalAccessContext)
      _ <- initialDataService.insertLocalDataStoreIfEnabled
    } yield {
      organization
    }

  private def createOrganizationFolder(organizationName: String, loginInfo: LoginInfo)(
      implicit request: RequestHeader) = {
    def sendRPCToDataStore(dataStore: DataStore, token: String) =
      rpc(s"${dataStore.url}/data/triggers/newOrganizationFolder")
        .addQueryString("token" -> token, "organizationName" -> organizationName)
        .get
        .futureBox

    for {
      token <- bearerTokenAuthenticatorService.createAndInit(loginInfo, TokenType.DataStore, deleteOld = false).toFox
      datastores <- dataStoreDAO.findAll(GlobalAccessContext)
      _ <- Future.sequence(datastores.map(sendRPCToDataStore(_, token)))
    } yield ()
  }

  def getCookie(email: String)(implicit requestHeader: RequestHeader): Future[Cookie] = {
    val loginInfo = LoginInfo(CredentialsProvider.ID, email.toLowerCase)
    for {
      authenticator <- combinedAuthenticatorService.create(loginInfo)
      value <- combinedAuthenticatorService.init(authenticator)
    } yield {
      value
    }
  }

}

case class InviteParameters(
    recipients: List[String],
    autoActivate: Boolean
)

object InviteParameters {
  implicit val jsonFormat: Format[InviteParameters] = Json.format[InviteParameters]
}
