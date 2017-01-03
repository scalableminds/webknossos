package controllers

import java.net.URLEncoder
import javax.inject.Inject

import scala.concurrent.Future

import akka.actor.ActorRef
import com.scalableminds.util.mail._
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import models.team.TeamService
import models.user._
import net.liftweb.common.Full
import org.apache.commons.codec.binary.Base64
import org.apache.commons.codec.digest.HmacUtils
import oxalis.mail.DefaultMails
import oxalis.security.Secured
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
    Play.configuration.getBoolean("application.authentication.enableDevAutoVerify") getOrElse false

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
        "email" -> email.verifying("user.email.trailingSpace", s => s.trim == s),
        "firstName" -> nonEmptyText(1, 30).verifying("user.firstName.trailingSpace", s => s.trim == s),
        "lastName" -> nonEmptyText(1, 30).verifying("user.lastName.trailingSpace", s => s.trim == s),
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
    if(ssoKey == "")
      logger.warn("No SSO key configured! To use single-sign-on a sso key needs to be defined in the configuration.")

    // Check if the request we recieved was signed using our private sso-key
    if(HmacUtils.hmacSha256Hex(ssoKey, sso) == sig){
      val payload = new String(Base64.decodeBase64(sso))
      val values = play.core.parsers.FormUrlEncodedParser.parse(payload)
      for{
        nonce <- values.get("nonce").flatMap(_.headOption) ?~> "Nonce is missing"
        returnUrl <- values.get("return_sso_url").flatMap(_.headOption) ?~> "Return url is missing"
      } yield {
        val returnPayload =
          s"nonce=$nonce&" +
            s"email=${URLEncoder.encode(request.user.email, "UTF-8")}&" +
            s"external_id=${request.user.id}&" +
            s"username=${request.user.abreviatedName}&" +
            s"name=${request.user.name}"
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
        UserService.findOneByEmail(emailAddress).futureBox.flatMap {
          case Full(_) =>
            formHtml(boundForm.withError("email", "user.email.alreadyInUse")).map(BadRequest(_))
          case _       =>
            for {
              user <- UserService.insert(team, emailAddress, firstName, lastName, password, automaticUserActivation)
              brainDBResult <- BrainTracing.register(user)
            } yield {
              Mailer ! Send(
                DefaultMails.registerMail(user.name, emailAddress, brainDBResult))
              Mailer ! Send(
                DefaultMails.registerAdminNotifyerMail(user, emailAddress, brainDBResult))
              if (automaticUserActivation) {
                Redirect(controllers.routes.Application.index)
                .withSession(Secured.createSession(user))
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
        UserService.auth(email.toLowerCase, password).map {
          user =>
            val redirectLocation =
              if (user.isActive && redirect != "")
                Redirect(redirect)
              else if(user.isActive)
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
      UserService.findOneByEmail(email).map { user =>
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
