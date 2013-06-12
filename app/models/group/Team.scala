package models.group

import play.api.libs.json.Json

case class Team(name: String)

object Team{
  def everyone = Team("Everyone")

  implicit val teamFormat = Json.format[Team]
}