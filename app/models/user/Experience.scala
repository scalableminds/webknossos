package models.user

import models.task._

case class Experience(domain: String, value: Int) {

  override def toString = {
    if (isEmpty)
      ""
    else
      s"$domain: $value"
  }

  def isEmpty =
    domain == "" && value == 0
}

object Experience {
  implicit def MapToExperienceList(m: Map[String, Int]) =
    m.map(e => Experience(e._1, e._2)).toList

  def empty = Experience("", 0)
  
  def fromForm(domain: String, value: Int) =
    Experience(domain.trim, value)
    
  type Experiences = Map[String, Int]

  // TODO: don't use tasks to find domain strings 
  def findAllDomains = Task.findAll.flatMap(_.training.map(_.domain)).toSet.toList
}