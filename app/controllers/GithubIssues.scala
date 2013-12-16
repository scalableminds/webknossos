package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import oxalis.security.Secured
import models.security.Role
import play.api.mvc._
import play.api.Logger
import models.user.User
import views.html
import play.api.Play
import play.api.Play.current
import play.api.i18n.Messages
import oxalis.mail.DefaultMails
import braingames.mail.Send
import play.api.libs.ws.WS
import com.ning.http.client.Realm
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future

case class GithubAuth(user: String, key: String)

object GithubIssues extends Controller with Secured {

  override val DefaultAccessRole = Role.User
  val conf = Play.configuration

  val githubUrl = "https://api.github.com"
  val authentication = for {
    user <- conf.getString("issues.github.user")
    key <- conf.getString("issues.github.key")
  } yield GithubAuth(user, key)

  val assignee = conf.getString("issues.github.defaultAssignee")
  val branchName = conf.getString("branchname") getOrElse "master"

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
        WS.url(githubUrl + "/repos/scalableminds/oxalis/issues")
        .withAuth(ghuser, key, Realm.AuthScheme.BASIC)
        .post(issue).map { response =>
          response.status == CREATED
        }
      case _ =>
        Future.successful(false)
    }
  }

  def mailIssue(user: User, summary: String, description: String) {
    val mail = DefaultMails.issueMail(user.name, user.email, summary, description)
    Application.Mailer ! Send(mail)
  }

  def handleSubmission(user: User, summary: String, description: String, issueType: String) = {
    if (issueType != "unrelated")
      createGithubIssue(user, summary, description, issueType)
    else {
      mailIssue(user, summary, description)
      Future.successful(true)
    }
  }

  def submit = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    Async {
      for {
        summary <- postParameter("summary") ?~> Messages("issue.summary.notSupplied")
        description <- postParameter("description") ?~> Messages("issue.description.notSupplied")
        issueType <- postParameter("type") ?~> Messages("issue.type.notSupplied")
        success <- handleSubmission(request.user, summary, description, issueType)
      } yield {
        val message = Messages(if (success) "issue.submit.success" else "issue.submit.failure")

        Ok(html.issue.close(success, message))
      }
    }
  }
}