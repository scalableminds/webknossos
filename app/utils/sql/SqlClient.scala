package utils.sql

import play.api.Configuration
import slick.jdbc.PostgresProfile
import telemetry.SlackNotificationService

import javax.inject.Inject

class SqlClient @Inject() (configuration: Configuration, slackNotificationService: SlackNotificationService) {
  lazy val db: PostgresProfile.backend.Database =
    PostgresProfile.api.Database.forConfig("slick.db", configuration.underlying)
  def getSlackNotificationService: SlackNotificationService = slackNotificationService
}
