package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import brainflight.security.Secured
import models.Role
import models.DataSet
import play.api.mvc._
import play.api.Logger
import models.graph.Experiment
import models.User
import org.apache.commons.codec.binary.Base64
import com.sun.jersey.api.client.WebResource
import com.sun.jersey.api.client.Client
import com.sun.jersey.api.client.ClientResponse
import views.html

object Jira extends Controller with Secured {

  def index = Authenticated{ implicit request =>
    Ok(html.jira.index())
  }
  
  def submit(title: String, message: String) = Authenticated { implicit request =>
    val auth = new String(Base64.encodeBase64("autoreporter:frw378iokl!24".getBytes))
    val client = Client.create();
    val webResource: WebResource = client.resource("https://jira.scm.io/rest/api/2/project")
    
    val response = webResource.header("Authorization", "Basic " + auth).`type`("application/json").accept("application/json").get(classOf[ClientResponse]);
    println(response)
    Ok
  }
}