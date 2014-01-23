package models.user

import models.task._
import scala.collection.breakOut
import play.api.libs.json.Json
import scala.async.Async._
import scala.concurrent.Future
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Experience a user needs to hold to acquire a task. The task itself defines the minimum experience needed.
 * @param domain Domain of the experience
 * @param value Amount of experience
 */
case class Experience(domain: String, value: Int) {

  override def toString = if (isEmpty) "" else s"$domain: $value"

  def isEmpty = domain == "" && value == 0
}

object Experience {
  implicit val experienceFormat = Json.format[Experience]

  type Experiences = Map[String, Int]

  implicit def MapToExperienceList(m: Map[String, Int]): List[Experience] =
    m.map {
      case (domain, value) => Experience(domain, value)
    }(breakOut)

  def empty = Experience("", 0)

  def fromForm(domain: String, value: Int) = Experience(domain.trim, value)
}

object ExperienceService {
  // TODO: don't use tasks to find domain strings
  def findAllDomains(implicit ctx: DBAccessContext): Future[Set[String]] = async {
    val tasks = await(TaskDAO.findAll)
    tasks.flatMap(_.training.map(_.domain))(breakOut)
  }
}