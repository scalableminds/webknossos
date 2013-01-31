package models.task

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import models.user.User
import models.tracing.Tracing
import models.tracing.TracingType

case class Training(
    domain: String,
    gain: Int,
    loss: Int,
    sample: ObjectId)

object Training {
  
  def empty = Training("", 10, 5, null)
  
  def toForm(t: Training) = 
    Some((t.domain, t.gain, t.loss))
    
  def fromForm(domain: String, gain: Int, loss: Int) =
    Training(domain, gain, loss, null)

  def findAssignableFor(user: User) = {
    Task.findAssignableFor(user, shouldBeTraining = true)
  }
}