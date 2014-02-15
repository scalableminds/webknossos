package models.task

import models.user.User
import play.api.libs.json.Json
import scala.concurrent.Future
import braingames.reactivemongo.DBAccessContext
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import braingames.util.Fox

case class Training(
    domain: String,
    gain: Int,
    loss: Int,
    sample: BSONObjectID)

object Training{

  implicit val trainingFormat = Json.format[Training]
  
  def empty = Training("", 10, 5, null)
  
  def toForm(t: Training) = 
    Some((t.domain, t.gain, t.loss))
    
  def fromForm(domain: String, gain: Int, loss: Int) =
    Training(domain, gain, loss, null)

  def findAssignableFor(user: User)(implicit ctx: DBAccessContext): Fox[List[Task]] = {
    TaskService.findAssignableFor(user, shouldBeTraining = true)
  }
}