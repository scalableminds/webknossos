package controllers

import java.net.URLEncoder

import akka.actor.ActorSystem
import javax.inject.Inject
import com.mohiva.play.silhouette.api.{LoginInfo, Silhouette}
import com.mohiva.play.silhouette.api.exceptions.ProviderException
import com.mohiva.play.silhouette.api.util.Credentials
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import com.scalableminds.util.mail._
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.binary.{DataStore, DataStoreDAO}
import models.team._
import models.user._
import net.liftweb.common.{Empty, EmptyBox, Failure, Full}
import org.apache.commons.codec.binary.Base64
import org.apache.commons.codec.digest.HmacUtils
import oxalis.mail.DefaultMails
import oxalis.security._
import oxalis.thirdparty.BrainTracing
import play.api._
import play.api.data.Form
import play.api.data.Forms.{email, _}
import play.api.data.validation.Constraints._
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json._
import play.api.libs.ws.WSResponse
import play.api.mvc._

import scala.concurrent.{ExecutionContext, Future}
import utils.{ObjectId, WkConf}

object AuthForms {

  val passwordMinLength = 8

  // Sign up
  case class SignUpData(organization: String,
                        organizationDisplayName: String,
                        email: String,
                        firstName: String,
                        lastName: String,
                        password: String)

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
        "lastName" -> nonEmptyText
      )((organization, organizationDisplayName, email, password, firstName, lastName) =>
        SignUpData(organization, organizationDisplayName, email, firstName, lastName, password._1))(
        signUpData =>
          Some(
            (signUpData.organization,
             signUpData.organizationDisplayName,
             signUpData.email,
             ("", ""),
             signUpData.firstName,
             signUpData.lastName))))

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
                               brainTracing: BrainTracing,
                               organizationDAO: OrganizationDAO,
                               userDAO: UserDAO,
                               defaultMails: DefaultMails,
                               rpc: RPC,
                               conf: WkConf,
                               wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
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

  def handleRegistration = Action.async { implicit request =>
    signUpForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      signUpData => {
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
                                           loginInfo,
                                           passwordHasher.hash(signUpData.password)) ?~> "user.creation.failed"
                brainDBResult <- brainTracing.registerIfNeeded(user, signUpData.password).toFox
              } yield {
                if (conf.Features.isDemoInstance) {
                  Mailer ! Send(defaultMails.newUserWKOrgMail(user.name, user.email, organization.enableAutoVerify))
                } else {
                  Mailer ! Send(
                    defaultMails.newUserMail(user.name, user.email, brainDBResult, organization.enableAutoVerify))
                }
                Mailer ! Send(defaultMails.registerAdminNotifyerMail(user, brainDBResult, organization))
                Ok
              }
            }
          case f: Failure => Fox.failure(f.msg)
        }
      }
    )
  }

  def authenticate = Action.async { implicit request =>
    signInForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      signInData => {
        val email = signInData.email.toLowerCase
        val credentials = Credentials(email, signInData.password)
        credentialsProvider
          .authenticate(credentials)
          .flatMap {
            loginInfo =>
              userService.retrieve(loginInfo).flatMap {
                case None =>
                  Future.successful(BadRequest(Messages("error.noUser")))
                case Some(user) if (!user.isDeactivated) =>
                  for {
                    authenticator <- combinedAuthenticatorService.create(loginInfo)
                    value <- combinedAuthenticatorService.init(authenticator)
                    result <- combinedAuthenticatorService.embed(value, Ok)
                  } yield result
                case Some(user) => Future.successful(BadRequest(Messages("user.deactivated")))
              }
          }
          .recover {
            case e: ProviderException => BadRequest(Messages("error.invalidCredentials"))
          }
      }
    )
  }

  def autoLogin = Action.async { implicit request =>
    for {
      _ <- bool2Fox(conf.Application.Authentication.enableDevAutoLogin) ?~> "error.notInDev"
      user <- userService.defaultUser
      authenticator <- combinedAuthenticatorService.create(user.loginInfo)
      value <- combinedAuthenticatorService.init(authenticator)
      result <- combinedAuthenticatorService.embed(value, Ok)
    } yield result
  }

  def switchTo(email: String) = sil.SecuredAction.async { implicit request =>
    implicit val ctx = GlobalAccessContext
    if (request.identity.isSuperUser) {
      val loginInfo = LoginInfo(CredentialsProvider.ID, email)
      for {
        _ <- userService.findOneByEmail(email) ?~> "user.notFound" ~> NOT_FOUND
        _ <- combinedAuthenticatorService.discard(request.authenticator, Ok) //to logout the admin
        authenticator <- combinedAuthenticatorService.create(loginInfo)
        value <- combinedAuthenticatorService.init(authenticator)
        result <- combinedAuthenticatorService.embed(value, Redirect("/dashboard")) //to login the new user
      } yield result
    } else {
      logger.warn(s"User tried to switch (${request.identity.email} -> $email) but is no Superuser!")
      Future.successful(Forbidden(Messages("user.notAuthorised")))
    }
  }

  // if a user has forgotten his password
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

  // if a user has forgotten his password
  def handleResetPassword = Action.async { implicit request =>
    resetPasswordForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      passwords => {
        bearerTokenAuthenticatorService.userForToken(passwords.token.trim)(GlobalAccessContext).futureBox.flatMap {
          case Full(user) =>
            for {
              _ <- userDAO.updatePasswordInfo(user._id, passwordHasher.hash(passwords.password1))(GlobalAccessContext)
              _ <- bearerTokenAuthenticatorService.remove(passwords.token.trim)
            } yield Ok
          case _ =>
            Future.successful(BadRequest(Messages("auth.invalidToken")))
        }
      }
    )
  }

  // a user who is logged in can change his password
  def changePassword = sil.SecuredAction.async { implicit request =>
    changePasswordForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      passwords => {
        val credentials = Credentials(request.identity.email, passwords.oldPassword)
        credentialsProvider
          .authenticate(credentials)
          .flatMap {
            loginInfo =>
              userService.retrieve(loginInfo).flatMap {
                case None =>
                  Future.successful(NotFound(Messages("error.noUser")))
                case Some(user) =>
                  val loginInfo = LoginInfo(CredentialsProvider.ID, request.identity.email)
                  for {
                    _ <- userService.changePasswordInfo(loginInfo, passwordHasher.hash(passwords.password1))
                    _ <- combinedAuthenticatorService.discard(request.authenticator, Ok)
                  } yield {
                    Mailer ! Send(defaultMails.changePasswordMail(user.name, request.identity.email))
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
          } yield {
            val returnPayload =
              s"nonce=$nonce&" +
                s"email=${URLEncoder.encode(user.email, "UTF-8")}&" +
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
                    _ <- checkOrganizationFolder ?~> "organization.folderCreation.failed"
                    organization <- createOrganization(
                      Option(signUpData.organization).filter(_.trim.nonEmpty),
                      signUpData.organizationDisplayName) ?~> "organization.create.failed"
                    user <- userService.insert(organization._id,
                                               email,
                                               firstName,
                                               lastName,
                                               isActive = true,
                                               isOrgTeamManager = true,
                                               loginInfo,
                                               passwordHasher.hash(signUpData.password),
                                               isAdmin = true) ?~> "user.creation.failed"
                    _ <- createOrganizationFolder(organization.name, loginInfo) ?~> "organization.folderCreation.failed"
                  } yield {
                    Mailer ! Send(
                      defaultMails.newOrganizationMail(organization.displayName,
                                                       email.toLowerCase,
                                                       request.headers.get("Host").getOrElse("")))
                    if (conf.Features.isDemoInstance) {
                      Mailer ! Send(defaultMails.newAdminWKOrgMail(user.firstName, user.email))
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

  private def creatingOrganizationsIsAllowed(requestingUser: Option[User]) = {
    val noOrganizationPresent = initialDataService.assertNoOrganizationsPresent
    val activatedInConfig = bool2Fox(conf.Features.isDemoInstance) ?~> "allowOrganizationCreation.notEnabled"
    val userIsSuperUser = bool2Fox(requestingUser.exists(_.isSuperUser))

    Fox.sequenceOfFulls(List(noOrganizationPresent, activatedInConfig, userIsSuperUser)).map(_.headOption).toFox
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
      future2Fox(
        rpc(s"${dataStore.url}/data/triggers/newOrganizationFolder")
          .addQueryString("token" -> token, "organizationName" -> organizationName)
          .get
          .futureBox)

    for {
      token <- bearerTokenAuthenticatorService.createAndInit(loginInfo, TokenType.DataStore, deleteOld = false).toFox
      datastores <- dataStoreDAO.findAll(GlobalAccessContext)
      _ <- Fox.combined(datastores.map(sendRPCToDataStore(_, token)))
    } yield ()
  }

  private def checkOrganizationFolder(implicit request: RequestHeader) =
    for {
      datastores <- dataStoreDAO.findAll(GlobalAccessContext)
      _ <- Fox.serialCombined(datastores)(d =>
        rpc(s"${d.url}/data/triggers/checkNewOrganizationFolder").get.futureBox.map {
          case Full(_) => Fox.successful(())
          // This failure exists if the datastore is down. We still want to be able to create organizations, therefore we ignore this error.
          case Failure(errorMsg, _, _) if errorMsg.contains("Connection refused") => Fox.successful(())
          case box: EmptyBox                                                      => box.toFox
      })
    } yield ()

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
