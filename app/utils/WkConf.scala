package utils

import com.scalableminds.util.tools.ConfigReader
import play.api.Play.current

object WkConf extends ConfigReader {
  override def raw = play.api.Play.configuration

  object Application {
    val insertInitialData = getBoolean("application.insertInitialData")
  }

  object Mail {
    val enabled = getBoolean("mail.enabled")
    object Smtp {
      val host = getString("mail.smtp.host")
      val port = getInt("mail.smtp.port")
      val tls = getBoolean("mail.smtp.tls")
      val auth = getBoolean("mail.smtp.auth")
      val user = getString("mail.smtp.user")
      val pass = getString("mail.smtp.pass")
    }
    object Subject {
      val prefix = getString("mail.subject.prefix")
    }
  }

  // passed to slick directly, not read from here
  object Postgres {
    val url = getString("postgres.url")
    val driver = getString("postgres.driver")
    val keepAliveConnection = getBoolean("postgres.keepAliveConnection")
    val user = getString("postgres.user")
    val password = getString("postgres.password")
    val queueSize = getInt("postgres.queueSize")
  }

}
