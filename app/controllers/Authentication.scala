package controllers


import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api.Authenticator.Implicits._
import com.mohiva.play.silhouette.api.{Environment, LoginInfo, Silhouette}
import com.mohiva.play.silhouette.api.exceptions.ProviderException
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator
import com.mohiva.play.silhouette.api.util.{Clock, Credentials, FingerprintGenerator, IDGenerator}
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticatorService
import com.scalableminds.util.mail._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.team.Role
import models.user.UserService
import models.user.UserService.{Mailer => _, _}
import models.user.UserTokenService
import models.user.UserToken2
import oxalis.security.silhouetteOxalis.{SecuredAction, SecuredRequest, UserAwareAction, UserAwareRequest}
import net.liftweb.common.{Empty, Failure, Full}
import oxalis.mail.DefaultMails
import oxalis.security._
import oxalis.thirdparty.BrainTracing
import oxalis.view.ProvidesUnauthorizedSessionData
import play.api.Play.current
import play.api._
import play.api.data.Form
import play.api.data.Forms._
import play.api.data.validation.Constraints._
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Akka
import play.api.libs.json._
import play.api.mvc.{Action, _}
import play.twirl.api.Html

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future


object AuthForms {

  // Sign up
  case class SignUpData(team: String, email: String, firstName: String, lastName: String, password: String)

  def signUpForm(implicit messages: Messages) = Form(mapping(
    "team" -> text,
    "email" -> email,
    "password1" -> nonEmptyText.verifying(minLength(8)),
    "password2" -> nonEmptyText, //.verifying(Messages("error.passwordsDontMatch"), password2 => password1 == password2),
    "firstName" -> nonEmptyText,
    "lastName" -> nonEmptyText
  )
  ((team, email, password1, password2, firstName, lastName) => SignUpData(team, email, firstName, lastName, password1))
  (signUpData => Some((signUpData.team, signUpData.email, signUpData.firstName, signUpData.lastName, "", "")))
  )

  // Sign in
  case class SignInData(email: String, password: String)

  val signInForm = Form(mapping(
    "email" -> email,
    "password" -> nonEmptyText
  )(SignInData.apply)(SignInData.unapply)
  )

  // Start password recovery
  val emailForm = Form(single("email" -> email))

  // Password recovery
  case class ResetPasswordData(token: String, password1: String, password2: String)

  def resetPasswordForm(implicit messages: Messages) = Form(mapping(
    "token" -> text,
    "password1" -> nonEmptyText.verifying(minLength(8)),
    "password2" -> nonEmptyText //.verifying(Messages("error.passwordsDontMatch"), password2 => password1 == password2),
  )(ResetPasswordData.apply)(ResetPasswordData.unapply)
  )

  case class ChangePasswordData(oldPassword: String, password1: String, password2: String)

  def changePasswordForm(implicit messages: Messages) = Form(mapping(
    "oldPassword" -> nonEmptyText,
    "password1" -> nonEmptyText.verifying(minLength(8)),
    "password2" -> nonEmptyText //.verifying(Messages("error.passwordsDontMatch"), password2 => password1 == password2),
  )(ChangePasswordData.apply)(ChangePasswordData.unapply)
  )
}


class Authentication @Inject()(
                                val messagesApi: MessagesApi,
                                credentialsProvider: CredentialsProvider,
                                userTokenService: UserTokenService,
                                passwordHasher: PasswordHasher,
                                configuration: Configuration)
  extends Controller
    with ProvidesUnauthorizedSessionData
    with FoxImplicits {

  import AuthForms._

  val env = silhouetteOxalis.environment

  private lazy val Mailer =
    Akka.system(play.api.Play.current).actorSelection("/user/mailActor")

  val automaticUserActivation: Boolean =
    configuration.getBoolean("application.authentication.enableDevAutoVerify").getOrElse(false)

  val roleOnRegistration: Role =
    if (configuration.getBoolean("application.authentication.enableDevAutoAdmin").getOrElse(false)) Role.Admin
    else Role.User

  def empty = UserAwareAction { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def emptyWithWildcard(param: String) = UserAwareAction { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def emptyWithWildcards(param1: String, param2: String) = UserAwareAction { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def normalizeName(name: String): Option[String] = {
    val replacementMap = Map("ü" -> "ue", "Ü" -> "Ue", "ö" -> "oe", "Ö" -> "Oe", "ä" -> "ae", "Ä" -> "Ae", "ß" -> "ss",
      "é" -> "e", "è" -> "e", "ê" -> "e", "È" -> "E", "É" -> "E", "Ê" -> "E",
      "Ç" -> "C", "ç" -> "c", "ñ" -> "n", "Ñ" -> "N", "ë" -> "e", "Ë" -> "E", "ï" -> "i", "Ï" -> "I",
      "å" -> "a", "Å" -> "A", "œ" -> "oe", "Œ" -> "Oe", "æ" -> "ae", "Æ" -> "Ae",
      "þ" -> "th", "Þ" -> "Th", "ø" -> "oe", "Ø" -> "Oe", "í" -> "i", "ì" -> "i")

    val finalName = name.map(c => replacementMap.getOrElse(c.toString, c.toString)).mkString.replaceAll("[^A-Za-z0-9_\\-\\s]", "")
    if (finalName.isEmpty)
      None
    else
      Some(finalName)
  }

  def handleRegistration = Action.async { implicit request =>
    signUpForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      signUpData => {
        val loginInfo = LoginInfo(CredentialsProvider.ID, signUpData.email)
        var errors = List[String]()
        val firstName = normalizeName(signUpData.firstName).getOrElse { errors ::= Messages("user.firstName.invalid"); "" }
        val lastName = normalizeName(signUpData.lastName).getOrElse { errors ::= Messages("user.lastName.invalid"); "" }
        UserService.retrieve(loginInfo).toFox.futureBox.flatMap {
          case Full(_) =>
            errors ::= Messages("user.email.alreadyInUse")
            Fox.successful(BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t))))))
          case Empty =>
            if (!errors.isEmpty) {
              Fox.successful(BadRequest(Json.obj("messages" -> Json.toJson(errors.map(t => Json.obj("error" -> t))))))
            } else {
              for {
                user <- UserService.insert(signUpData.team, signUpData.email, firstName, lastName, signUpData.password, automaticUserActivation, roleOnRegistration,
                  loginInfo, passwordHasher.hash(signUpData.password))
                brainDBResult <- BrainTracing.register(user).toFox
              } yield {
                Mailer ! Send(DefaultMails.registerMail(user.name, user.email, brainDBResult))
                Mailer ! Send(DefaultMails.registerAdminNotifyerMail(user, user.email, brainDBResult))
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
        val credentials = Credentials(signInData.email, signInData.password)
        credentialsProvider.authenticate(credentials).flatMap { loginInfo =>
          UserService.retrieve(loginInfo).flatMap {
            case None =>
              Future.successful(BadRequest(Messages("error.noUser")))
            case Some(user) if (user.isActive) => for {
              authenticator <- env.authenticatorService.create(loginInfo)
              value <- env.authenticatorService.init(authenticator)
              result <- env.authenticatorService.embed(value, Ok)
            } yield result
            case Some(user) => Future.successful(BadRequest(Messages("user.deactivated")))
          }
        }.recover {
          case e: ProviderException => BadRequest(Messages("error.invalidCredentials"))
        }
      }
    )
  }

  def autoLogin = Action.async { implicit request =>
    for {
      _ <- Play.configuration.getBoolean("application.authentication.enableDevAutoLogin").get ?~> Messages("error.notInDev")
      user <- UserService.defaultUser
      authenticator <- env.authenticatorService.create(user.loginInfo)
      value <- env.authenticatorService.init(authenticator)
      result <- env.authenticatorService.embed(value, Ok)
    } yield result
  }

  def switchTo(email: String) = SecuredAction.async { implicit request =>
    if (request.identity._isSuperUser.openOr(false)) {
      val loginInfo = LoginInfo(CredentialsProvider.ID, email)
      for {
        _ <- findOneByEmail(email) ?~> Messages("user.notFound")
        _ <- env.authenticatorService.discard(request.authenticator, Ok) //to logout the admin
        authenticator <- env.authenticatorService.create(loginInfo)
        value <- env.authenticatorService.init(authenticator)
        result <- env.authenticatorService.embed(value, Ok) //to login the new user
      } yield result
    } else {
      Logger.warn(s"User tried to switch (${request.identity.email} -> $email) but is no Superuser!")
      Future.successful(BadRequest(Messages("user.notAuthorised")))
    }
  }

  // if a user has forgotten his password
  def handleStartResetPassword = Action.async { implicit request =>
    emailForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      email => UserService.retrieve(LoginInfo(CredentialsProvider.ID, email)).flatMap {
        case None => Future.successful(BadRequest(Messages("error.noUser")))
        case Some(user) => for {
          token <- userTokenService.save(UserToken2.create(user._id, email, isLogin = false))
        } yield {
          Mailer ! Send(DefaultMails.resetPasswordMail(user.name, email, token.id.toString))
          Ok
        }
      }
    )
  }

  // if a user has forgotten his password
  def handleResetPassword = Action.async { implicit request =>
    resetPasswordForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      passwords => {
        val id = UUID.fromString(passwords.token)
        userTokenService.find(id).flatMap {
          case None =>
            Future.successful(BadRequest(Messages("error.invalidToken")))
          case Some(token) if !token.isLogin && !token.isExpired =>
            val loginInfo = LoginInfo(CredentialsProvider.ID, token.email)
            for {
              _ <- userTokenService.remove(id)
              _ <- UserService.changePasswordInfo(loginInfo, passwordHasher.hash(passwords.password1))
            } yield Ok
        }
      }
    )
  }

  // a user who is logged in can change his password
  def changePassword = SecuredAction.async { implicit request =>
    changePasswordForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(bogusForm.toString)),
      passwords => {
        val credentials = Credentials(request.identity.email, passwords.oldPassword)
        credentialsProvider.authenticate(credentials).flatMap { loginInfo =>
          UserService.retrieve(loginInfo).flatMap {
            case None =>
              Future.successful(BadRequest(Messages("error.noUser")))
            case Some(user) => val loginInfo = LoginInfo(CredentialsProvider.ID, request.identity.email)
              for {
                _ <- UserService.changePasswordInfo(loginInfo, passwordHasher.hash(passwords.password1))
                _ <- env.authenticatorService.discard(request.authenticator, Ok)
              } yield {
                Mailer ! Send(DefaultMails.changePasswordMail(user.name, request.identity.email))
                Ok
              }
          }
        }.recover {
          case e: ProviderException => BadRequest(Messages("error.invalidCredentials"))
        }
      }
    )
  }

  def logout = SecuredAction.async { implicit request =>
    env.authenticatorService.discard(request.authenticator, Ok)
  }
}

object Authentication {
  def getLoginRoute() = {
    "/login"
  }

  def getCookie(email: String)(implicit requestHeader: RequestHeader): Future[Cookie] = {
    val loginInfo = LoginInfo(CredentialsProvider.ID, email)
    for {
      authenticator <- silhouetteOxalis.environment.authenticatorService.create(loginInfo)
      value <- silhouetteOxalis.environment.authenticatorService.init(authenticator)
    } yield {
      value
    }
  }
}
