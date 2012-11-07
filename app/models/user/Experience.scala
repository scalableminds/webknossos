package models.user

import models.task.TrainingsTask

case class Experience(domain: String, value: Int){
  
  override def toString = "%d @ %s".format(value, domain)
}

object Experience { 
  
  def empty = Experience("", 0)
  type Experiences = Map[String, Int]
  
  def findAllDomains = TrainingsTask.findAll.map(_.experienceDomain).toSet.toList
}