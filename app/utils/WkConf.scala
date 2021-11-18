package utils

import com.scalableminds.util.tools.ConfigReader
import com.typesafe.scalalogging.LazyLogging
import play.api.Configuration
import javax.inject.Inject

import scala.concurrent.duration._

class WkConf @Inject()(configuration: Configuration) extends ConfigReader with LazyLogging {
  override def raw: Configuration = configuration

  object Http {
    val uri: String = get[String]("http.uri")
    val port: String = get[String]("http.port")
  }

  object Play {
    object Modules {
      val enabled: Seq[String] = getList[String]("play.modules.enabled")
      val disabled: Seq[String] = getList[String]("play.modules.disabled")
    }
    val children = List(Modules)
  }

  object WebKnossos {
    val tabTitle: String = get[String]("webKnossos.tabTitle")
    object User {
      val timeTrackingPause: FiniteDuration = get[FiniteDuration]("webKnossos.user.timeTrackingPause")
      val inviteExpiry: Duration = get[Duration]("webKnossos.user.inviteExpiry")
      val ssoKey: String = get[String]("webKnossos.user.ssoKey")
    }
    val newOrganizationMailingList: String = get[String]("webKnossos.newOrganizationMailingList")
    object Tasks {
      val maxOpenPerUser: Int = get[Int]("webKnossos.tasks.maxOpenPerUser")
    }
    object Cache {
      object User {
        val timeout: FiniteDuration = get[FiniteDuration]("webKnossos.cache.user.timeout")
      }
      val children = List(User)
    }
    object SampleOrganization {
      val enabled: Boolean = get[Boolean]("webKnossos.sampleOrganization.enabled")
      object User {
        val email: String = get[String]("webKnossos.sampleOrganization.user.email")
        val password: String = get[String]("webKnossos.sampleOrganization.user.password")
        val token: String = get[String]("webKnossos.sampleOrganization.user.token")
        val isSuperUser: Boolean = get[Boolean]("webKnossos.sampleOrganization.user.isSuperUser")
      }
      val children = List(User)
    }
    val operatorData: String = get[String]("webKnossos.operatorData")
    val children = List(User, Tasks, Cache, SampleOrganization)
  }

  object Features {
    val isDemoInstance: Boolean = get[Boolean]("features.isDemoInstance")
    val jobsEnabled: Boolean = get[Boolean]("features.jobsEnabled")
    val taskReopenAllowed: FiniteDuration = get[Int]("features.taskReopenAllowedInSeconds") seconds
    val allowDeleteDatasets: Boolean = get[Boolean]("features.allowDeleteDatasets")
    val publicDemoDatasetUrl: String = get[String]("features.publicDemoDatasetUrl")
    val exportTiffMaxVolumeMVx: Long = get[Long]("features.exportTiffMaxVolumeMVx")
    val exportTiffMaxEdgeLengthVx: Long = get[Long]("features.exportTiffMaxEdgeLengthVx")
  }

  object Datastore {
    val key: String = get[String]("datastore.key")
    val name: String = get[String]("datastore.name")
    val publicUri: Option[String] = getOptional[String]("datastore.publicUri")
  }

  object Tracingstore {
    val key: String = get[String]("tracingstore.key")
    val name: String = get[String]("datastore.name")
    val publicUri: Option[String] = getOptional[String]("tracingstore.publicUri")
  }

  object Proxy {
    val prefix: String = get[String]("proxy.prefix")
    val routes: List[String] = getList[String]("proxy.routes")
  }

  object Mail {
    val logToStdout: Boolean = get[Boolean]("mail.logToStdout")
    object Smtp {
      val host: String = get[String]("mail.smtp.host")
      val port: Int = get[Int]("mail.smtp.port")
      val tls: Boolean = get[Boolean]("mail.smtp.tls")
      val auth: Boolean = get[Boolean]("mail.smtp.auth")
      val user: String = get[String]("mail.smtp.user")
      val pass: String = get[String]("mail.smtp.pass")
    }
    val defaultSender: String = get[String]("mail.defaultSender")
    object Mailchimp {
      val host: String = get[String]("mail.mailchimp.host")
      val listId: String = get[String]("mail.mailchimp.listId")
      val user: String = get[String]("mail.mailchimp.user")
      val password: String = get[String]("mail.mailchimp.password")
    }
    val children = List(Smtp, Mailchimp)
  }

  object Silhouette {
    object TokenAuthenticator {
      val resetPasswordExpiry: Duration = get[Duration]("silhouette.tokenAuthenticator.resetPasswordExpiry")
      val dataStoreExpiry: Duration = get[Duration]("silhouette.tokenAuthenticator.dataStoreExpiry")
      val authenticatorExpiry: Duration = get[Duration]("silhouette.tokenAuthenticator.authenticatorExpiry")
      val authenticatorIdleTimeout: Duration = get[Duration]("silhouette.tokenAuthenticator.authenticatorIdleTimeout")
    }
    object CookieAuthenticator {
      val cookieName: String = get[String]("silhouette.cookieAuthenticator.cookieName")
      val cookiePath: String = get[String]("silhouette.cookieAuthenticator.cookiePath")
      val secureCookie: Boolean = get[Boolean]("silhouette.cookieAuthenticator.secureCookie")
      val httpOnlyCookie: Boolean = get[Boolean]("silhouette.cookieAuthenticator.httpOnlyCookie")
      val useFingerprinting: Boolean = get[Boolean]("silhouette.cookieAuthenticator.useFingerprinting")
      val authenticatorExpiry: Duration = get[Duration]("silhouette.cookieAuthenticator.authenticatorExpiry")
      val cookieMaxAge: Duration = get[Duration]("silhouette.cookieAuthenticator.cookieMaxAge")
    }
    val children = List(TokenAuthenticator, CookieAuthenticator)
  }

  object Jobs {
    val workerLivenessTimeout: FiniteDuration = get[FiniteDuration]("jobs.workerLivenessTimeout")
  }

  object Braintracing {
    val enabled: Boolean = get[Boolean]("braintracing.enabled")
    val organizationName: String = get[String]("braintracing.organizationName")
    val uri: String = get[String]("braintracing.uri")
    val createUserScript: String = get[String]("braintracing.createUserScript")
    val user: String = get[String]("braintracing.user")
    val password: String = get[String]("braintracing.password")
    val license: String = get[String]("braintracing.license")
  }

  object Airbrake {
    val projectID: String = get[String]("airbrake.projectID")
    val projectKey: String = get[String]("airbrake.projectKey")
    val environment: String = get[String]("airbrake.environment")
  }

  object GoogleAnalytics {
    val trackingId: String = get[String]("googleAnalytics.trackingId")
  }

  object SlackNotifications {
    val uri: String = get[String]("slackNotifications.uri")
    val verboseLoggingEnabled: Boolean = get[Boolean]("slackNotifications.verboseLoggingEnabled")
  }

  object BackendAnalytics {
    val uri: String = get[String]("backendAnalytics.uri")
    val key: String = get[String]("backendAnalytics.key")
    val sessionPause: FiniteDuration = get[FiniteDuration]("backendAnalytics.sessionPause")
    val verboseLoggingEnabled: Boolean = get[Boolean]("backendAnalytics.verboseLoggingEnabled")
  }

  val children =
    List(
      Http,
      WebKnossos,
      Features,
      Tracingstore,
      Datastore,
      Proxy,
      Mail,
      Silhouette,
      Jobs,
      Braintracing,
      Airbrake,
      GoogleAnalytics,
      BackendAnalytics
    )

  val removedConfigKeys = List(
    "actor.defaultTimeout",
    "js.defaultTimeout",
    "application.name",
    "application.branch",
    "application.version",
    "application.title",
    "application.insertInitialData",
    "application.insertLocalConnectDatastore",
    "application.authentication.defaultuser.email",
    "application.authentication.defaultUser.password",
    "application.authentication.defaultUser.token",
    "application.authentication.defaultUser.isSuperUser",
    "application.authentication.ssoKey",
    "application.authentication.inviteExpiry",
    "webKnossos.user.time.tracingPauseInSeconds",
    "webKnossos.query.maxResults",
    "user.cacheTimeoutInMinutes",
    "tracingstore.enabled",
    "datastore.enabled",
    "datastore.webKnossos.pingIntervalMinutes",
    "braingames.binary.cacheMaxSize",
    "braingames.binary.mappingCacheMaxSize",
    "braingames.binary.agglomerateFileCacheMaxSize",
    "braingames.binary.agglomerateCacheMaxSize",
    "braingames.binary.agglomerateStandardBlockSize",
    "braingames.binary.agglomerateMaxReaderRange",
    "braingames.binary.loadTimeout",
    "braingames.binary.saveTimeout",
    "braingames.binary.isosurfaceTimeout",
    "braingames.binary.isosurfaceActorPoolSize",
    "braingames.binary.baseFolder",
    "braingames.binary.agglomerateSkeletonEdgeLimit",
    "braingames.binary.changeHandler.enabled",
    "braingames.binary.tickerInterval",
    "mail.enabled",
    "jobs.username",
    "braintracing.active",
    "braintracing.url",
    "airbrake.apiKey",
    "airbrake.ssl",
    "airbrake.enabled",
    "airbrake.endpoint",
    "slackNotifications.url",
    "google.analytics.trackingId",
    "operatorData"
  )

  def warnIfOldKeysPresent(): Unit = removedConfigKeys.foreach { key =>
    if (getOptional[String](key).isDefined) {
      logger.warn(s"Removed config key $key is still supplied. Did you migrate your config?")
    }
  }
}
