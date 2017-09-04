package controllers

import java.net.URLEncoder
import javax.inject.Inject

import scala.concurrent.Future
import akka.actor.ActorRef
import com.scalableminds.util.mail._
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import models.{Profile, User, UserToken}
import models.team.{Role, TeamService}
import models.user.UserService.{Mailer => _, _}
import models.user._
import net.liftweb.common.Full
import org.apache.commons.codec.binary.Base64
import org.apache.commons.codec.digest.HmacUtils
import oxalis.mail.DefaultMails
import oxalis.view.ProvidesUnauthorizedSessionData
import play.api.data.validation.Constraints
//import oxalis.security.Secured // --------------------------------------------------
import oxalis.thirdparty.BrainTracing
import oxalis.view.{ProvidesUnauthorizedSessionData, SessionData}
import play.api.Play.current
import play.api._
import play.api.data.Forms._
import play.api.data._
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Akka
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc.Action
import views.html


import java.util.UUID
import javax.inject.Inject

import scala.concurrent.Future
import scala.concurrent.duration._

import net.ceedubs.ficus.Ficus._

import com.mohiva.play.silhouette.api.Authenticator.Implicits._
import com.mohiva.play.silhouette.api.{Environment,LoginInfo,Silhouette}
import com.mohiva.play.silhouette.api.exceptions.ProviderException
import com.mohiva.play.silhouette.api.repositories.AuthInfoRepository
import com.mohiva.play.silhouette.api.services.AvatarService
import com.mohiva.play.silhouette.api.util.{Credentials,PasswordHasher}
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator
import com.mohiva.play.silhouette.impl.exceptions.IdentityNotFoundException
import com.mohiva.play.silhouette.impl.providers._

import play.api._
import play.api.data.Form
import play.api.data.Forms._
import play.api.data.validation.Constraints._
import play.api.mvc._
import play.api.i18n.{I18nSupport,MessagesApi,Messages}
import play.api.libs.concurrent.Execution.Implicits._

import models.user.UserService

//import models.{Profile,User}
//import services.{UserService,UserTokenService}
//import utils.Mailer

import org.joda.time.DateTime



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

  def register = Action.async { implicit request =>
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
  def handleRegistration = Action.async { implicit request =>
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


  //---------------------------------------------------------------------------------------------------------------------
  // new auth

object AuthForms {

  // Sign up
  case class SignUpData(team:String, email:String, password:String, firstName:String, lastName:String)

  val team: Mapping[String] = text verifying Constraints.nonEmpty

  def signUpForm(implicit messages:Messages) = Form(mapping(
    "team" -> team,
    "email" -> email,
    "password" -> tuple(
      "password1" -> nonEmptyText.verifying(minLength(6)),
      "password2" -> nonEmptyText
    ).verifying(Messages("error.passwordsDontMatch"), password => password._1 == password._2),
    "firstName" -> nonEmptyText,
    "lastName" -> nonEmptyText
  )
  ((team, email, password, firstName, lastName) => SignUpData(team, email, password._1, firstName, lastName))
  (signUpData => Some((signUpData.team, signUpData.email, ("",""), signUpData.firstName, signUpData.lastName)))
  )

  // Sign in
  case class SignInData(email:String, password:String, rememberMe:Boolean)
  val signInForm = Form(mapping(
    "email" -> email,
    "password" -> nonEmptyText,
    "rememberMe" -> boolean
  )(SignInData.apply)(SignInData.unapply)
  )

  // Start password recovery
  val emailForm = Form(single("email" -> email))

  // Passord recovery
  def resetPasswordForm(implicit messages:Messages) = Form(tuple(
    "password1" -> nonEmptyText.verifying(minLength(6)),
    "password2" -> nonEmptyText
  ).verifying(Messages("error.passwordsDontMatch"), password => password._1 == password._2))
}


class Auth @Inject() (
                       val messagesApi: MessagesApi,
                       val env:Environment[User,CookieAuthenticator],
                       socialProviderRegistry: SocialProviderRegistry,
                       authInfoRepository: AuthInfoRepository,
                       credentialsProvider: CredentialsProvider,
                       userTokenService: UserTokenService,
                       avatarService: AvatarService,
                       passwordHasher: PasswordHasher,
                       configuration: Configuration) extends Silhouette[User,CookieAuthenticator] {

  import AuthForms._

  private lazy val Mailer =
    Akka.system(play.api.Play.current).actorSelection("/user/mailActor")

  val automaticUserActivation: Boolean =
    configuration.getBoolean("application.authentication.enableDevAutoVerify").getOrElse(false)

  val roleOnRegistration: Role =
    if (configuration.getBoolean("application.authentication.enableDevAutoAdmin").getOrElse(false)) Role.Admin
    else Role.User

  def startSignUp = UserAwareAction.async { implicit request =>
    Future.successful(request.identity match {
      case Some(user) => Redirect(routes.Application.index)
      case None => Ok(views.html.auth.startSignUp(signUpForm))
    })
  }

  def handleStartSignUp = Action.async { implicit request =>
    signUpForm.bindFromRequest.fold(
      bogusForm => Future.successful(Redirect(routes.Application.index)), // the register.html has to be updated
      signUpData => {
        val loginInfo = LoginInfo(CredentialsProvider.ID, signUpData.email)
        UserService.retrieve(loginInfo).flatMap{
          case Some(_) =>
            Future.successful(Redirect(routes.Authentication.startSignUp()).flashing("error" -> Messages("error.userExists", signUpData.email)))
          case None =>
            for {
              user <- UserService.insert(team, signUpData.email, signUpData.firstName, signUpData.lastName, signUpData.password, automaticUserActivation, roleOnRegistration)
              brainDBResult <- BrainTracing.register(user)
            } yield {
              /*
              Mailer ! Send(
                DefaultMails.registerMail(user.name, emailAddress, brainDBResult))
              Mailer ! Send(
                DefaultMails.registerAdminNotifyerMail(user, emailAddress, brainDBResult))
                */
              if (automaticUserActivation) {
                Future.successful(Redirect(routes.Application.index))
                //.withSession(Secured.createSession(user))
              } else {
                Future.successful(Redirect(routes.Authentication.login(None))
                  .flashing("modal" -> "Your account has been created. An administrator is going to unlock you soon."))
              }
            }
            /*
            val user =
              User(
              email = signUpData.email,
              firstName = signUpData.firstName,
              lastName = signUpData.lastName,
              loginInfo = loginInfo,
              fullName = Some(s"${signUpData.firstName} ${signUpData.lastName}"),
              passwordInfo = None,
              oauth1Info = None)
            for {
              _ <- UserService.save(user) //use insert method from UserService: automaticly inserts it in teams (maybe remove self written method "save" in UserDAO)
              _ <- authInfoRepository.add(loginInfo, passwordHasher.hash(signUpData.password))
              token <- userTokenService.save(UserToken.create(user.id, signUpData.email, true))
            } yield {
              mailer.welcome(user, link = routes.Auth.signUp(token.id.toString).absoluteURL())
              Ok(views.html.auth.finishSignUp(profile))
              //an der alten implementierung orientieren
            }
            */
        }
      }
    )
  }

  def signUp(tokenId:String) = Action.async { implicit request =>
    val id = UUID.fromString(tokenId)
    userTokenService.find(id).flatMap {
      case None =>
        Future.successful(NotFound(views.html.errors.notFound(request)))
      case Some(token) if token.isSignUp && !token.isExpired =>
        UserService.find(token.userId).flatMap {
          case None => Future.failed(new IdentityNotFoundException(Messages("error.noUser")))
          case Some(user) =>
            val loginInfo = LoginInfo(CredentialsProvider.ID, token.email)
            for {
              authenticator <- env.authenticatorService.create(loginInfo)
              value <- env.authenticatorService.init(authenticator)
              _ <- UserService.confirm(loginInfo)
              _ <- userTokenService.remove(id)
              result <- env.authenticatorService.embed(value, Redirect(routes.Application.index()))
            } yield result
        }
      case Some(token) =>
        userTokenService.remove(id).map {_ => NotFound(views.html.errors.notFound(request))}
    }
  }

  def signIn = UserAwareAction.async { implicit request =>
    Future.successful(request.identity match {
      case Some(user) => Redirect(routes.Application.index())
      case None => Ok(views.html.auth.signIn(signInForm,socialProviderRegistry))
    })
  }

  def authenticate = Action.async { implicit request =>
    signInForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(views.html.auth.signIn(bogusForm, socialProviderRegistry))),
      signInData => {
        val credentials = Credentials(signInData.email, signInData.password)
        credentialsProvider.authenticate(credentials).flatMap { loginInfo =>
          UserService.retrieve(loginInfo).flatMap {
            //change this to Box when it is working (need to change retrieve()...)
            case None =>
              Future.successful(Redirect(routes.Auth.signIn()).flashing("error" -> Messages("error.noUser")))
            case Some(user) if !user.profileFor(loginInfo).map(_.confirmed).getOrElse(false) =>
              Future.successful(Redirect(routes.Auth.signIn()).flashing("error" -> Messages("error.unregistered", signInData.email)))
            case Some(_) => for {
              authenticator <- env.authenticatorService.create(loginInfo).map {
                case authenticator if signInData.rememberMe =>
                  val c = configuration.underlying
                  authenticator.copy(
                    expirationDateTime = new DateTime() + c.as[FiniteDuration]("silhouette.authenticator.rememberMe.authenticatorExpiry"),
                    idleTimeout = c.getAs[FiniteDuration]("silhouette.authenticator.rememberMe.authenticatorIdleTimeout"),
                    cookieMaxAge = c.getAs[FiniteDuration]("silhouette.authenticator.rememberMe.cookieMaxAge")
                  )
                case authenticator => authenticator
              }
              value <- env.authenticatorService.init(authenticator)
              result <- env.authenticatorService.embed(value, Redirect(routes.Application.index()))
            } yield result
          }
        }.recover {
          case e:ProviderException => Redirect(routes.Auth.signIn()).flashing("error" -> Messages("error.invalidCredentials"))
        }
      }
    )
  }

  def signOut = SecuredAction.async { implicit request =>
    env.authenticatorService.discard(request.authenticator, Redirect(routes.Application.index()))
  }

  def startResetPassword = Action { implicit request =>
    Ok(views.html.auth.startResetPassword(emailForm))
  }

  def handleStartResetPassword = Action.async { implicit request =>
    emailForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(views.html.auth.startResetPassword(bogusForm))),
      email => UserService.retrieve(LoginInfo(CredentialsProvider.ID, email)).flatMap {
        case None => Future.successful(Redirect(routes.Auth.startResetPassword()).flashing("error" -> Messages("error.noUser")))
        case Some(user) => for {
          token <- userTokenService.save(UserToken.create(user.id, email, isSignUp = false))
        } yield {
          Mailer ! Send(
            DefaultMails.changePasswordMail(email, user.name))
          Ok(views.html.auth.resetPasswordInstructions(email))
        }
      }
    )
  }

  def resetPassword(tokenId:String) = Action.async { implicit request =>
    val id = UUID.fromString(tokenId)
    userTokenService.find(id).flatMap {
      case None =>
        Future.successful(NotFound(views.html.errors.notFound(request)))
      case Some(token) if !token.isSignUp && !token.isExpired =>
        Future.successful(Ok(views.html.auth.resetPassword(tokenId, resetPasswordForm)))
      case _ => for {
        _ <- userTokenService.remove(id)
      } yield NotFound(views.html.errors.notFound(request))
    }
  }

  def handleResetPassword(tokenId:String) = Action.async { implicit request =>
    resetPasswordForm.bindFromRequest.fold(
      bogusForm => Future.successful(BadRequest(views.html.auth.resetPassword(tokenId, bogusForm))),
      passwords => {
        val id = UUID.fromString(tokenId)
        userTokenService.find(id).flatMap {
          case None =>
            Future.successful(NotFound(views.html.errors.notFound(request)))
          case Some(token) if !token.isSignUp && !token.isExpired =>
            val loginInfo = LoginInfo(CredentialsProvider.ID, token.email)
            for {
              _ <- authInfoRepository.save(loginInfo, passwordHasher.hash(passwords._1))
              authenticator <- env.authenticatorService.create(loginInfo)
              value <- env.authenticatorService.init(authenticator)
              _ <- userTokenService.remove(id)
              result <- env.authenticatorService.embed(value, Ok(views.html.auth.resetPasswordDone()))
            } yield result
        }
      }
    )
  }
}
