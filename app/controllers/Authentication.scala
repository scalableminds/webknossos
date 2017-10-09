package controllers

import com.mohiva.play.silhouette.api.util.{Clock, Credentials, FingerprintGenerator, IDGenerator}
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticatorService
import com.scalableminds.util.mail._
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Converter, Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.team.{Role, TeamService}
import models.user.UserService.{Mailer => _, _}
import models.user._
import net.liftweb.common.{Empty, Failure, Full}
import org.apache.commons.codec.binary.Base64
import org.apache.commons.codec.digest.HmacUtils
import oxalis.mail.DefaultMails
import oxalis.security._
import oxalis.security.silhouetteOxalis.{SecuredAction, SecuredRequest, UserAwareAction, UserAwareRequest}
import play.api.data.validation.Constraints
import play.twirl.api.Html
import oxalis.thirdparty.BrainTracing
import oxalis.view.{ProvidesUnauthorizedSessionData, SessionData}
import play.api.libs.concurrent.Akka
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc.Action
import java.util.UUID
import javax.inject.Inject

import scala.concurrent.Future
import scala.concurrent.duration._
import scala.concurrent.ExecutionContext.Implicits.global
import net.ceedubs.ficus.Ficus._
import net.ceedubs.ficus.readers.ArbitraryTypeReader._
import com.mohiva.play.silhouette.api.Authenticator.Implicits._
import com.mohiva.play.silhouette.api.{Environment, LoginInfo, Silhouette}
import com.mohiva.play.silhouette.api.exceptions.ProviderException
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator
import play.api._
import play.api.data.Form
import play.api.data.Forms._
import play.api.data.validation.Constraints._
import play.api.mvc._
import play.api.i18n.{I18nSupport, Messages, MessagesApi}

import scala.concurrent.ExecutionContext.Implicits.global
import models.user.UserService


object AuthForms {
  // Sign up
  case class SignUpData(team:String, email:String, firstName:String, lastName:String, password:String)

  def signUpForm(implicit messages:Messages) = Form(mapping(
    "team" -> text,
    "email" -> email,
    "password1" -> nonEmptyText.verifying(minLength(8)),
    "password2" -> nonEmptyText,//.verifying(Messages("error.passwordsDontMatch"), password2 => password1 == password2),
    "firstName" -> nonEmptyText,
    "lastName" -> nonEmptyText
  )
  ((team, email, password1, password2, firstName, lastName) => SignUpData(team, email, firstName, lastName, password1))
  (signUpData => Some((signUpData.team, signUpData.email, signUpData.firstName, signUpData.lastName, "", "")))
  )

  // Sign in
  case class SignInData(email:String, password:String)
  val signInForm = Form(mapping(
    "email" -> email,
    "password" -> nonEmptyText
  )(SignInData.apply)(SignInData.unapply)
  )

  // Start password recovery
  val emailForm = Form(single("email" -> email))

  // Passord recovery
  case class ResetPasswordData(token: String, password1: String, password2: String)
  def resetPasswordForm(implicit messages:Messages) = Form(mapping(
    "token" -> text,
    "password1" -> nonEmptyText.verifying(minLength(8)),
    "password2" -> nonEmptyText//.verifying(Messages("error.passwordsDontMatch"), password2 => password1 == password2),
  )(ResetPasswordData.apply)(ResetPasswordData.unapply)
  )

  case class ChangePasswordData(oldPassword: String, password1: String, password2: String)
  def changePasswordForm(implicit messages:Messages) = Form(mapping(
    "oldPassword" -> nonEmptyText,
    "password1" -> nonEmptyText.verifying(minLength(8)),
    "password2" -> nonEmptyText//.verifying(Messages("error.passwordsDontMatch"), password2 => password1 == password2),
  )(ChangePasswordData.apply)(ChangePasswordData.unapply)
  )
}


class Authentication @Inject() (
                       val messagesApi: MessagesApi,
                       credentialsProvider: CredentialsProvider,
                       userTokenService: UserTokenService,
                       passwordHasher: PasswordHasher,
                       configuration: Configuration)
  extends Controller
    with ProvidesUnauthorizedSessionData {

  import AuthForms._

  val env = silhouetteOxalis.environment

  private lazy val Mailer =
    Akka.system(play.api.Play.current).actorSelection("/user/mailActor")

  val automaticUserActivation: Boolean =
    configuration.getBoolean("application.authentication.enableDevAutoVerify").getOrElse(false)

  val roleOnRegistration: Role =
    if (configuration.getBoolean("application.authentication.enableDevAutoAdmin").getOrElse(false)) Role.Admin
    else Role.User

  def empty = Action { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def handleRegistration = Action.async { implicit request =>
    signUpForm.bindFromRequest.fold(
      bogusForm =>  Future.successful(JsonBadRequest(bogusForm.errors.toList.map(error => (error.key, error.message)))),
      signUpData => {
        val loginInfo = LoginInfo(CredentialsProvider.ID, signUpData.email)
        UserService.retrieve(loginInfo).toFox.futureBox.flatMap {
          case Full(_) =>
            Fox.successful(JsonOk(Messages("error.userExists", signUpData.email)))
          case Empty =>
            for {
              user <- UserService.insert(signUpData.team, signUpData.email, signUpData.firstName, signUpData.lastName, signUpData.password, automaticUserActivation, roleOnRegistration,
                                         loginInfo, passwordHasher.hash(signUpData.password))
              brainDBResult <- BrainTracing.register(user).toFox
            } yield {
              Mailer ! Send(DefaultMails.registerMail(user.name, emailAddress.toString, brainDBResult))
              Mailer ! Send(DefaultMails.registerAdminNotifyerMail(user, emailAddress.toString, brainDBResult))
              if (automaticUserActivation) {
                JsonOk(Messages("user.automaticUserActivation"))
              } else {
                JsonOk(Messages("user.accountCreated"))
              }
            }
          case f: Failure => Fox.failure(f.msg)
        }
      }
    )
  }

  def authenticate = Action.async { implicit request =>
    signInForm.bindFromRequest.fold(
      bogusForm => Future.successful(JsonBadRequest(bogusForm.errors.toList.map(error => (error.key, error.message)))),
      signInData => {
        val credentials = Credentials(signInData.email, signInData.password)
        credentialsProvider.authenticate(credentials).flatMap { loginInfo =>
          UserService.retrieve(loginInfo).flatMap {
            case None =>
              Future.successful(JsonOk(Messages("error.noUser")))
            case Some(user) if(user.isActive) => for {
              authenticator <- env.authenticatorService.create(loginInfo)
              value <- env.authenticatorService.init(authenticator)
              result <- env.authenticatorService.embed(value, Ok)
            } yield result//Ok
            case Some(user) => Future.successful(BadRequest(Messages("user.deactivated")))
          }
        }.recover {
          case e:ProviderException => BadRequest(Messages("error.invalidCredentials"))
        }
      }
    )
  }

  def switchTo(email: String) = SecuredAction.async { implicit request =>
    if(request.identity._isSuperUser.openOr(false)){
      val loginInfo = LoginInfo(CredentialsProvider.ID, email)
      for {
        _ <- findOneByEmail(email) ?~> Messages("user.notFound")
        _ <- env.authenticatorService.discard(request.authenticator, Ok) //to logout the admin
        authenticator <- env.authenticatorService.create(loginInfo)
        value <- env.authenticatorService.init(authenticator)
        result <- env.authenticatorService.embed(value, Ok) //to login the new user
      } yield result
    }else{
      Logger.warn(s"User tried to switch (${request.identity.email} -> $email) but is no Superuser!")
      Future.successful(BadRequest(Messages("user.notAuthorised")))
    }
  }

  // if a user has forgotten his password
  def handleStartResetPassword = Action.async { implicit request =>
    emailForm.bindFromRequest.fold(
      bogusForm => Future.successful(JsonBadRequest(bogusForm.errors.toList.map(error => (error.key, error.message)))),
      email => UserService.retrieve(LoginInfo(CredentialsProvider.ID, email)).flatMap {
        case None => Future.successful(BadRequest(Messages("error.noUser")))
        case Some(user) => for {
          token <- userTokenService.save(UserToken.create(user._id, email, isSignUp = false))
        } yield {
          Mailer ! Send(DefaultMails.resetPasswordMail(user.name, email, token.id.toString))
          Ok
        }
      }
    )
  }

  // if a user has forgotten his password
  def handleResetPassword = Action.async { implicit request => //(tokenId:String)
    resetPasswordForm.bindFromRequest.fold(
      bogusForm => Future.successful(JsonBadRequest(bogusForm.errors.toList.map(error => (error.key, error.message)))),
      passwords => {
        val id = UUID.fromString(passwords.token)
        userTokenService.find(id).flatMap {
          case None =>
            Future.successful(NotFound(views.html.error.defaultError("token not found", true)))
          case Some(token) if !token.isSignUp && !token.isExpired =>
            val loginInfo = LoginInfo(CredentialsProvider.ID, token.email)
            for {
              _ <- UserService.changePasswordInfo(loginInfo, passwordHasher.hash(passwords.password1))
            } yield Ok
        }
      }
    )
  }

  // a user who is logged in can change his password
  def changePassword = SecuredAction.async { implicit request =>
    changePasswordForm.bindFromRequest.fold(
      bogusForm => Future.successful(JsonBadRequest(bogusForm.errors.toList.map(error => (error.key, error.message)))),
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
          case e:ProviderException => BadRequest(Messages("error.invalidCredentials"))
        }
      }
    )
  }

  def logout = SecuredAction.async { implicit request =>
    env.authenticatorService.discard(request.authenticator, Redirect(routes.Application.index()))
  }
}

object Authentication {
  def getLoginRoute() = {
    "/login"
  }
}
