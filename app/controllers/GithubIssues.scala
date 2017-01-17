package controllers

import javax.inject.Inject

import com.ning.http.client.Realm
import com.scalableminds.util.mail.Send
import models.user.User
import oxalis.mail.DefaultMails
import oxalis.security.Secured
import play.api.Play.current
import play.api.i18n.{MessagesApi, Messages}
import play.api.libs.concurrent.Akka
import play.api.libs.ws.{WSAuthScheme, WS}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json._
import play.api.libs.json._
import play.api.{Logger, Play}
import views.html
import scala.concurrent.Future

case class GithubAuth(user: String, key: String)

class GithubIssues @Inject() (val messagesApi: MessagesApi) extends Controller with Secured {

  lazy val Mailer =
    Akka.system(play.api.Play.current).actorSelection("/user/mailActor")

  val conf = Play.configuration

  val githubUrl = "https://api.github.com"

  val authentication = for {
    user <- conf.getString("issues.github.user")
    key <- conf.getString("issues.github.key")
  } yield GithubAuth(user, key)

  val assignee = conf.getString("issues.github.defaultAssignee")

  val branchName = conf.getString("application.branch") getOrElse "master"

  if (authentication.isEmpty)
    Logger.warn("Github authentication configuration is missing.")

  def index = Authenticated { implicit request =>
    Ok(html.issue.index())
  }

  def createIssueJson(user: User, summary: String, description: String, issueType: String) = {
    Json.obj(
      "title" -> summary,
      "body" -> (description + s"\n\n Reported by: ${user.name} (${user.email}) on $branchName"),
      "assignee" -> assignee,
      "labels" -> List(issueType).filter(_ == ""))
  }

  def createGithubIssue(user: User, summary: String, description: String, issueType: String) = {
    val issue = createIssueJson(user, summary, description, issueType)

    authentication match {
      case Some(GithubAuth(ghuser, key)) =>
        WS
          .url(githubUrl + "/repos/scalableminds/webknossos/issues")
          .withAuth(ghuser, key, WSAuthScheme.BASIC)
          .post(issue).map { response =>
          response.status == CREATED
        }
      case _ =>
        Future.successful(false)
    }
  }

  def submit = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    for {
      summary <- postParameter("summary") ?~> Messages("issue.summary.notSupplied")
      description <- postParameter("description") ?~> Messages("issue.description.notSupplied")
      issueType <- postParameter("type") ?~> Messages("issue.type.notSupplied")
      success <- createGithubIssue(request.user, summary, description, issueType)
    } yield {
      val message = Messages(if (success) "issue.submit.success" else "issue.submit.failure")
      Ok(html.issue.close(success, message))
    }
  }
}
