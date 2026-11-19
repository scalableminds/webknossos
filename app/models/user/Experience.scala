package models.user

import com.scalableminds.util.tools.JsonAutoFormat

/** Experience a user needs to hold to acquire a task. The task itself defines the minimum experience needed.
  * @param domain
  *   Domain of the experience
  * @param value
  *   Amount of experience
  */
case class Experience(domain: String, value: Int) derives JsonAutoFormat {
  def trim: Experience = this.copy(domain = this.domain.trim)
}

object Experience {
  // An empty domain is treated as no experience requirement, e.g. for empty columns in bulk task creation.
  def normalize(experienceOpt: Option[Experience]): Option[Experience] =
    experienceOpt.map(_.trim).filter(_.domain.nonEmpty)
}
