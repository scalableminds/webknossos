package models.user

import models.task._

case class Experience(domain: String, value: Int){
  
  override def toString = "%d @ %s".format(value, domain)
}

object Experience { 
  
  def empty = Experience("", 0)
  type Experiences = Map[String, Int]
  
  // TODO: don't use tasks to find domain strings 
  def findAllDomains = Task.findAll.flatMap(_.training.map(_.domain)).toSet.toList
}