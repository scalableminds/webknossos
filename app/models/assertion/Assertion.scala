package models.assertion

import models.basics._
import org.bson.types.ObjectId
import models.user.{UserService, User}
import play.api.libs.json.JsObject
import braingames.util.FoxImplicits
import play.api.libs.concurrent.Execution.Implicits._

case class Assertion(
  _user: Option[ObjectId],
  timestamp: Long,
  value: String,
  title: String,
  message: String,
  stacktrace: String,
  globalContext: String,
  localContext: String,
  _id: ObjectId = new ObjectId) extends DAOCaseClass[Assertion] with FoxImplicits{

  val dao = Assertion
  
  def id = _id.toString
  
  def user = _user.toFox.flatMap(id => UserService.findOneById(id.toString , useCache = true))
}

object Assertion extends BasicDAO[Assertion]("assertions"){
  
}