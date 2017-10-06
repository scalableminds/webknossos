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
import org.joda.time.DateTime
import play.api.mvc.Results.Redirect


/*
class Authentication @Inject()(val messagesApi: MessagesApi, val configuration: Configuration)
  extends Controller
    with Secured
    with ProvidesUnauthorizedSessionData
    with LazyLogging {

  private lazy val Mailer =
    Akka.system(play.api.Play.current).actorSelection("/user/mailActor")

  private lazy val ssoKey =
    configuration.getString("application.authentication.ssoKey").getOrElse("")

  // -- Authentication
  val automaticUserActivation: Boolean =
    configuration.getBoolean("application.authentication.enableDevAutoVerify").getOrElse(false)

  val roleOnRegistration: Role =
    if (configuration.getBoolean("application.authentication.enableDevAutoAdmin").getOrElse(false)) Role.Admin
    else Role.User

  val registerForm: Form[(String, String, String, String, String)] = {

    def registerFormApply(team: String, email: String, firstName: String, lastName: String, password: (String, String)) =
      (team, email.toLowerCase, firstName, lastName, password._1)

    def registerFormUnapply(user: (String, String, String, String, String)) =
      Some((user._1, user._2, user._3, user._4, ("", "")))

    val passwordField = tuple("main" -> text, "validation" -> text)
      .verifying("user.password.nomatch", pw => pw._1 == pw._2)
      .verifying("user.password.tooshort", pw => pw._1.length >= 8)

    Form(
      mapping(
        "team" -> text,
        "email" -> email,
        "firstName" -> text.transform(_.trim, identity[String]).verifying("user.firstName.empty", s => s.length > 0),
        "lastName" -> text.transform(_.trim, identity[String]).verifying("user.lastName.empty", s => s.length > 0),
        "password" -> passwordField)(registerFormApply)(registerFormUnapply))
  }

  def register2 = Action.async { implicit request =>
    formHtml(registerForm).map(Ok(_))
  }

  def formHtml(form: Form[(String, String, String, String, String)])(implicit session: SessionData) = {
    for {
      teams <- TeamService.rootTeams()
    } yield html.user.register(form, teams)
  }

  def singleSignOn(sso: String, sig: String) = Authenticated.async { implicit request =>
    if (ssoKey == "")
      logger.warn("No SSO key configured! To use single-sign-on a sso key needs to be defined in the configuration.")

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
            s"email=${URLEncoder.encode(request.user.email, "UTF-8")}&" +
            s"external_id=${URLEncoder.encode(request.user.id, "UTF-8")}&" +
            s"username=${URLEncoder.encode(request.user.abreviatedName, "UTF-8")}&" +
            s"name=${URLEncoder.encode(request.user.name, "UTF-8")}"
        val encodedReturnPayload = Base64.encodeBase64String(returnPayload.getBytes("UTF-8"))
        val returnSignature = HmacUtils.hmacSha256Hex(ssoKey, encodedReturnPayload)
        val query = "sso=" + URLEncoder.encode(encodedReturnPayload, "UTF-8") + "&sig=" + returnSignature
        Redirect(returnUrl + "?" + query)
      }
    } else {
      Fox.successful(BadRequest("Invalid signature"))
    }
  }

  /**
    * Handle registration form submission.
    */
  def handleRegistration2 = Action.async { implicit request =>
    val boundForm = registerForm.bindFromRequest
    boundForm.fold(
      formWithErrors =>
        formHtml(formWithErrors).map(BadRequest(_)), {
        case (team, emailAddress, firstName, lastName, password) => {
          findOneByEmail(emailAddress).futureBox.flatMap {
            case Full(_) =>
              formHtml(boundForm.withError("email", "user.email.alreadyInUse")).map(BadRequest(_))
            case _ =>
              for {
                user <- insert(
                  team, emailAddress, firstName, lastName, password, automaticUserActivation, roleOnRegistration)
                brainDBResult <- BrainTracing.register(user)
              } yield {
                Mailer ! Send(
                  DefaultMails.registerMail(user.name, emailAddress, brainDBResult))
                Mailer ! Send(
                  DefaultMails.registerAdminNotifyerMail(user, emailAddress, brainDBResult))
                if (automaticUserActivation) {
                  Redirect(controllers.routes.Application.index)
                    //.withSession(Secured.createSession(user))
                } else {
                  Redirect(controllers.routes.Authentication.login(None))
                    .flashing("modal" -> "Your account has been created. An administrator is going to unlock you soon.")
                }
              }
          }
        }
      })
  }

  val loginForm = Form(
    tuple(
      "email" -> text,
      "password" -> text,
      "redirect" -> text))

  /**
    * Login page.
    */
  def login(redirect: Option[String]) = Action { implicit request =>
    Ok(html.user.login(loginForm.fill(("", "", redirect.getOrElse("")))))
  }

  /**
    * Handle login form submission.
    */
  def authenticate = Action.async { implicit request =>
    loginForm.bindFromRequest.fold(
      formWithErrors =>
        Future.successful(BadRequest(html.user.login(formWithErrors))), {
        case (email, password, redirect) =>
          auth(email.toLowerCase, password).map {
            user =>
              val redirectLocation =
                if (user.isActive && redirect != "")
                  Redirect(redirect)
                else if (user.isActive)
                  Redirect(controllers.routes.Application.index)
                else
                  BadRequest(html.user.login(loginForm.bindFromRequest.withGlobalError("user.deactivated")))
              redirectLocation.withSession(Secured.createSession(user))

          }.getOrElse {
            BadRequest(html.user.login(loginForm.bindFromRequest.withGlobalError("user.login.failed")))
          }
      })
  }

  /**
    * Authenticate as a different user
    */
  def switchTo(email: String) = Authenticated.async { implicit request =>
    if (request.user.isSuperUser) {
      findOneByEmail(email).map { user =>
        Logger.info(s"[Superuser] user switch (${request.user.email} -> $email)")
        Redirect(controllers.routes.Application.index).withSession(Secured.createSession(user))
      }
    } else {
      Logger.warn(s"User tried to switch (${request.user.email} -> $email) but is no Superuser!")
      Future.successful(
        BadRequest(html.user.login(loginForm.withGlobalError("user.login.failed"))(sessionDataAuthenticated(request), request2Messages(request))))
    }
  }

  /**
    * Logout and clean the session.
    */
  def logout = Action {
    Redirect(controllers.routes.Authentication.login(None))
      .withNewSession
      .flashing("success" -> Messages("user.logout.success"))
  }
}
*/


  //---------------------------------------------------------------------------------------------------------------------
  // new auth

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

  //val silhouette = new Silhouette[User,CookieAuthenticator] {def env: Environment[User, CookieAuthenticator] = env; def messagesApi: MessagesApi = messagesApi}
  //val env = new EnvironmentOxalis(configuration)

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
                //Redirect(Authentication.getLoginRoute)
                //  .flashing("modal" -> "Your account has been created. An administrator is going to unlock you soon.")
              }
            }
          case f: Failure => Fox.failure(f.msg)
        }
      }
    )
  }

  def authenticate = Action.async { implicit request =>
    signInForm.bindFromRequest.fold(
      bogusForm => Future.successful(JsonBadRequest(bogusForm.errors.toList.map(error => (error.key, error.message)))),//Future.successful(Redirect(Authentication.getLoginRoute))
      signInData => {
        val credentials = Credentials(signInData.email, signInData.password)
        credentialsProvider.authenticate(credentials).flatMap { loginInfo =>
          UserService.retrieve(loginInfo).flatMap {
            case None =>
              Future.successful(Redirect("").flashing("error" -> Messages("error.noUser")))
              Future.successful(JsonOk(Messages("error.noUser")))
            case Some(user) if(user.isActive) => for {
              authenticator <- env.authenticatorService.create(loginInfo)
              value <- env.authenticatorService.init(authenticator)
              result <- env.authenticatorService.embed(value, Redirect(routes.Application.index()))
            } yield result
            case Some(user) => Future.successful(BadRequest(Messages("user.deactivated"))) //I want to stay on this site but show the error "user is deactivated"
          }
        }.recover {
          case e:ProviderException => JsonOk(Messages("error.invalidCredentials"))//Redirect(routes.Authentication.signIn()).flashing("error" -> Messages("error.invalidCredentials"))
        }
      }
    )
  }

  def switchTo(email: String) = SecuredAction.async { implicit request =>
    if(request.identity._isSuperUser.openOr(false)){
      val loginInfo = LoginInfo(CredentialsProvider.ID, email)
      for {
        _ <- findOneByEmail(email) ?~> Messages("user.notFound")
        _ <- env.authenticatorService.discard(request.authenticator, Redirect(routes.Application.index())) //to logout the admin
        authenticator <- env.authenticatorService.create(loginInfo)
        value <- env.authenticatorService.init(authenticator)
        result <- env.authenticatorService.embed(value, Redirect(routes.Application.index())) //to login the new user
      } yield result
    }else{
      Logger.warn(s"User tried to switch (${request.identity.email} -> $email) but is no Superuser!")
      Future.successful(BadRequest(Messages("user.notAuthorised")))
    }
  }

  // if a user has forgotten his password
  def handleStartResetPassword = Action.async { implicit request =>
    emailForm.bindFromRequest.fold(
      bogusForm => Future.successful(JsonOk("wrong Form")), //this needs to be changed //Future.successful(BadRequest(views.html.auth.startResetPassword(bogusForm))),
      email => UserService.retrieve(LoginInfo(CredentialsProvider.ID, email)).flatMap {
        case None => Future.successful(JsonOk(Messages("error.noUser")))//Future.successful(Redirect(routes.Authentication.startResetPassword()).flashing("error" -> Messages("error.noUser")))
        case Some(user) => for {
          token <- userTokenService.save(UserToken.create(user._id, email, isSignUp = false))
        } yield {
          Mailer ! Send(DefaultMails.resetPasswordMail(user.name, email, token.id.toString))
          //Mailer ! Send(DefaultMails.changePasswordMail(user.name, email))
          //Redirect("/finishreset")
          Redirect(routes.Application.index()) //why do these Redirect not work?
          //Ok(views.html.auth.resetPasswordInstructions(email))
        }
      }
    )
  }


  // if a user has forgotten his password
  def handleResetPassword = Action.async { implicit request => //(tokenId:String)
    resetPasswordForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest("from form (handleResetPassword)")),//Future.successful(BadRequest(views.html.auth.resetPassword(tokenId, bogusForm))),
      passwords => {
        val id = UUID.fromString(passwords.token)
        userTokenService.find(id).flatMap {
          case None =>
            Future.successful(NotFound(views.html.error.defaultError("token not found", true))) //views.html.errors.notFound(request)
          case Some(token) if !token.isSignUp && !token.isExpired =>
            val loginInfo = LoginInfo(CredentialsProvider.ID, token.email)
            for {
              _ <- UserService.changePasswordInfo(loginInfo, passwordHasher.hash(passwords.password1))
              authenticator <- env.authenticatorService.create(loginInfo)
              value <- env.authenticatorService.init(authenticator)
              _ <- userTokenService.remove(id)
              result <- env.authenticatorService.embed(value, Redirect(routes.Application.index()))
            } yield result
        }
      }
    )
  }

  // a user who is logged in can change his password
  def changePassword = SecuredAction.async { implicit request =>
    changePasswordForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest("from form (handleResetPassword)")),//Future.successful(BadRequest(views.html.auth.resetPassword(tokenId, bogusForm))),
      passwords => {
        val credentials = Credentials(request.identity.email, passwords.oldPassword)
        credentialsProvider.authenticate(credentials).flatMap { loginInfo =>
          UserService.retrieve(loginInfo).flatMap {
            case None =>
              Future.successful(Redirect("").flashing("error" -> Messages("error.noUser")))
              Future.successful(JsonOk(Messages("error.noUser")))
            case Some(user) => val loginInfo = LoginInfo(CredentialsProvider.ID, request.identity.email)
              for {
                _ <- UserService.changePasswordInfo(loginInfo, passwordHasher.hash(passwords.password1))
              //should the user be logge out or automatically stay login with the new credentials ?
                _ <- env.authenticatorService.discard(request.authenticator, Redirect(routes.Application.index())) //in case he should be logged out
                //authenticator <- env.authenticatorService.create(loginInfo) //in case he should stay logged in
                //value <- env.authenticatorService.init(authenticator) //in case he should stay logged in
                //result <- env.authenticatorService.embed(value, Redirect(Authentication.getLoginRoute())) //in case he should stay logged in
              } yield {
                Redirect(Authentication.getLoginRoute()) //in case he should be logged out
                //result //in case he should stay logged in

                //the ridirect still does not work
              }
          }
        }.recover {
          case e:ProviderException => JsonOk(Messages("error.invalidCredentials"))//Redirect(routes.Authentication.signIn()).flashing("error" -> Messages("error.invalidCredentials"))
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
