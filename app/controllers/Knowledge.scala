package controllers
import brainflight.security.Secured
import play.api._
import play.api.mvc._
import play.api.data._
import play.api.libs.json._
import play.api.Play.current
import java.io.File
import scala.io.Source
import models.knowledge.Mission
import models.security.Role


object Knowledge extends Controller with Secured{
  override val DefaultAccessRole = Role.Admin
  
  val KnowledgeDirectory = "/home/deployboy/knowledge"
  
  def updateKnowledge() = Action {
    for(knowledgeFile <- new File(KnowledgeDirectory).listFiles){
      extractKnowledge(knowledgeFile)
      markAsKnown(knowledgeFile)
    }
    Ok("ok")
  }
  
  def extractKnowledge(file: File) = {
    val source = Source.fromFile(file)
    val content = source.getLines.mkString("/n")
    val json = Json.parse(content)
    for {task <- (json \ "tasks").asOpt[List[JsValue]]
    } println ("do something")
    
  }
  
  def markAsKnown(file: File) = {
    file.renameTo(new File(KnowledgeDirectory+"/"+file.getName))
  }
}
