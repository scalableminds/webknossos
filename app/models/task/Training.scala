package models.task

import com.mongodb.casbah.Imports._
import models.user.User

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