package models.task

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import models.user.User

case class Training(
    domain: String,
    gain: Int,
    loss: Int)

object Training {
  
  def empty = Training("", 10, 5)

  def hasDoneTraining(user: User, t: Task) = {
    println("Has Done: " + t.experiments.find(_._user == user._id))
    t.experiments.find(_._user == user._id).isDefined
  }

  def findAllFor(user: User) = {
    Task.findAllTrainings.filter(t => 
      Task.hasEnoughExperience(user)(t) && !hasDoneTraining(user, t))
  }
}