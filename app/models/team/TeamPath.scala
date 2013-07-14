package models.team

import org.json4s.JsonAST.JString
import play.api.libs.json.Json
import java.util.regex.Pattern

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 13.07.13
 * Time: 21:19
 */
case class TeamPath(elements: List[String]) {
  override def toString = TeamPath.pathStringFor(elements)

  def toStringWithWhiteSpace = TeamPath.prettyfiedPathStringFor(elements)

  def toRegex = TeamPath.regexStringFor(elements)

  def +:(element: String) =
    TeamPath(element +: elements)

  def implies(teamPath: TeamPath) = {
    def implies(a: List[String], b: List[String]): Boolean = {
      (a, b) match {
        case (a1 :: _, _) if a1 == TeamPath.All =>
          true
        case (_, b1 :: _) if b1 == TeamPath.All =>
          true
        case (Nil, Nil) =>
          true
        case (a1 :: atail, b1 :: btail) if a1 == b1 =>
          implies(atail, btail)
        case _ =>
          false
      }
    }
    implies(elements, teamPath.elements)
  }
}

object TeamPath {

  val TeamSeparator = "/"

  val All = "*"

  val teamPathFormat = Json.format[TeamPath]

  def pathStringFor(elements: List[String]) = {
    TeamSeparator + elements.mkString(TeamSeparator)
  }

  def prettyfiedPathStringFor(elements: List[String]) = {
    TeamSeparator + " "  + elements.mkString(" " + TeamSeparator + " ")
  }

  def fromString(s: String) = {
    TeamPath(s.split(TeamSeparator).filterNot(_.isEmpty).toList)
  }

  def regexStringFor(elements: List[String]) = {
    val separator = Pattern.quote(TeamSeparator)
    val all = Pattern.quote(All)

    def regexify(elements: List[String]): String = elements match {
      case All :: tail =>
        separator + ".*" + regexify(tail)
      case element :: tail =>
        val regexSaveElement = Pattern.quote(element)
        s"$separator($all|($regexSaveElement${regexify(tail)}))"
      case _ =>
        ""
    }
    "^"+regexify(elements)
  }
}
