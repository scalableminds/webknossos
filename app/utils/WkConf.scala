package utils

import com.scalableminds.util.tools.ConfigReader
import play.api.Play.current

import scala.concurrent.duration._

object WkConf extends ConfigReader {
  override def raw = play.api.Play.configuration

  object Application {

    val insertInitialData = getBoolean("application.insertInitialData")

    object Authentication {
      object DefaultUser {
        val email = getString("application.authentication.defaultUser.email")
        val password = getString("application.authentication.defaultUser.password")
        val isSuperUser = getBoolean("application.authentication.defaultUser.isSuperUser")
      }
      val ssoKey = getString("application.authentication.ssoKey")
      val enableDevAutoVerify = getBoolean("application.authentication.enableDevAutoVerify")
      val enableDevAutoAdmin = getBoolean("application.authentication.enableDevAutoAdmin")
      val enableDevAutoLogin = getBoolean("application.authentication.enableDevAutoLogin")
      val children = List(DefaultUser)
    }
    val children = List(Authentication)
  }

  object Http {
    val uri = getString("http.uri")
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

  object Oxalis {
    object User {
      object Time {
        val tracingPauseInSeconds = getInt("oxalis.user.time.tracingPauseInSeconds") seconds
      }
      val children = List(Time)
    }
    object Tasks {
      val maxOpenPerUser = getInt("oxalis.tasks.maxOpenPerUser")
    }
    val newOrganizationMailingList = getString("oxalis.newOrganizationMailingList")

    val children = List(User, Tasks)
  }

  object Datastore {
    val enabled = getBoolean("datastore.enabled")
    val key = getString("datastore.key")
  }

  object User {
    val cacheTimeoutInMinutes = getInt("user.cacheTimeoutInMinutes") minutes
  }

  object Braintracing {
    val active = getBoolean("braintracing.active")
    val user = getString("braintracing.user")
    val password = getString("braintracing.password")
    val license = getString("braintracing.license")
  }

  object Features {
    val allowOrganizationCreation = getBoolean("features.allowOrganizationCreation")
  }

  val operatorData = getString("operatorData")

  object Silhouette {
    object TokenAuthenticator {
      val resetPasswordExpiry = getDuration("silhouette.tokenAuthenticator.resetPasswordExpiry")
      val dataStoreExpiry = getDuration("silhouette.tokenAuthenticator.dataStoreExpiry")
    }
    val children = List(TokenAuthenticator)
  }

  object Airbrake {
    val projectID = getString("airbrake.projectID")
    val projectKey = getString("airbrake.projectKey")
    val environment = getString("airbrake.environment")
  }

  object Google {
    object Analytics {
      val trackingID = getString("google.analytics.trackingID")
    }
    val children = List(Analytics)
  }

  val children = List(Application, Http, Mail, Oxalis, Datastore, User, Braintracing, Features, Silhouette, Airbrake, Google)
}
