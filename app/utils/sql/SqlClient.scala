package utils.sql

import oxalis.telemetry.SlackNotificationService
import play.api.Configuration
import slick.jdbc.PostgresProfile
import slick.jdbc.PostgresProfile.api._

import javax.inject.Inject

class SqlClient @Inject()(configuration: Configuration, slackNotificationService: SlackNotificationService) {
  lazy val db: PostgresProfile.backend.Database = Database.forConfig("slick.db", configuration.underlying)
  def getSlackNotificationService: SlackNotificationService = slackNotificationService
}
