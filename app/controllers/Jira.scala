package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import brainflight.security.Secured
import models.security.Role
import models.binary.DataSet
import play.api.mvc._
import play.api.Logger
import models.tracing.Tracing
import models.user.User
import org.apache.commons.codec.binary.Base64
import com.sun.jersey.api.client.WebResource
import com.sun.jersey.api.client.Client
import com.sun.jersey.api.client.ClientResponse
import views.html
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import brainflight.security.InsecureSSLSocketFactory._
import play.api.Play
import play.api.Play.current
import play.api.i18n.Messages
import braingames.mvc.Controller

object Jira extends Controller with Secured {

  val jiraUrl = "https://jira.scm.io"
  val issueTypes = Map("bug" -> "Bug", "feature" -> "New Feature")
  val conf = Play.configuration
  val branchName = conf.getString("branchname") getOrElse "master"

  def index = Authenticated { implicit request =>
    Ok(html.jira.index())
  }

  def createIssueJson(user: User, summary: String, description: String, issueType: String) = {
    Json.obj(
      "fields" -> Json.obj(
        "project" -> Json.obj(
          "key" -> "OX"),
        "summary" -> summary,
        "security" -> Json.obj(
          "id" -> "10000"),
        "customfield_10008" -> branchName,
        "customfield_10301" -> user.email,
        "description" -> (description + "\n\n Reported by: %s (%s)".format(user.name, user.email)),
        "issuetype" -> Json.obj(
          "name" -> issueType))).toString
  }

  def createIssue(user: User, summary: String, description: String, issueType: String) {
    val auth = new String(Base64.encodeBase64("autoreporter:frw378iokl!24".getBytes))
    val client = Client.create();

    val issue = createIssueJson(user, summary, description, issueType)

    usingSelfSignedCert {
      val webResource: WebResource = client.resource(jiraUrl + "/rest/api/2/issue")

      val response = webResource
        .header("Authorization", "Basic " + auth)
        .`type`("application/json")
        .accept("application/json")
        .post(classOf[ClientResponse], issue)
        
      Logger.debug(response.toString)
    }
  }

  def submit = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      summary <- postParameter("summary") ?~ Messages("jira.summary.notSupplied")
      description <- postParameter("description") ?~ Messages("jira.description.notSupplied")
      postedType <- postParameter("type") ?~ Messages("jira.type.notSupplied")
      issueType <- issueTypes.get(postedType) ?~ Messages("jira.type.invalid")
    } yield {
      createIssue(request.user, summary, description, issueType)
      Ok(html.jira.close())
    } 
  }
}