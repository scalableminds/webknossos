import com.google.inject.AbstractModule
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import controllers.{Application, InitialDataService}
import controllers.InitialDataService
import controllers.AuthenticationController
import files.TempFileService
import mail.MailchimpTicker
import models.analytics.AnalyticsSessionService
import models.annotation.{AnnotationMutexService, AnnotationStore, TracingDataSourceTemporaryStore}
import models.dataset.{DatasetService, ThumbnailCachingService}
import models.job.{JobService, WorkerLivenessService}
import models.storage.UsedStorageService
import models.task.TaskService
import models.user._
import models.user.time.TimeSpanService
import models.voxelytics.LokiClient
import security.CertificateValidationService
import telemetry.SlackNotificationService
import utils.sql.SqlClient

class WebknossosModule extends AbstractModule {
  override def configure(): Unit = {
    bind(classOf[Application]).asEagerSingleton()
    bind(classOf[Startup]).asEagerSingleton()
    bind(classOf[SqlClient]).asEagerSingleton()
    bind(classOf[InitialDataService]).asEagerSingleton()
    bind(classOf[UserService]).asEagerSingleton()
    bind(classOf[TaskService]).asEagerSingleton()
    bind(classOf[UserDAO]).asEagerSingleton()
    bind(classOf[AnnotationStore]).asEagerSingleton()
    bind(classOf[AnnotationMutexService]).asEagerSingleton()
    bind(classOf[DatasetService]).asEagerSingleton()
    bind(classOf[TimeSpanService]).asEagerSingleton()
    bind(classOf[DataVaultService]).asEagerSingleton()
    bind(classOf[TempFileService]).asEagerSingleton()
    bind(classOf[MailchimpTicker]).asEagerSingleton()
    bind(classOf[JobService]).asEagerSingleton()
    bind(classOf[SlackNotificationService]).asEagerSingleton()
    bind(classOf[AnalyticsSessionService]).asEagerSingleton()
    bind(classOf[WorkerLivenessService]).asEagerSingleton()
    bind(classOf[LokiClient]).asEagerSingleton()
    bind(classOf[UsedStorageService]).asEagerSingleton()
    bind(classOf[ThumbnailCachingService]).asEagerSingleton()
    bind(classOf[TracingDataSourceTemporaryStore]).asEagerSingleton()
    bind(classOf[CertificateValidationService]).asEagerSingleton()
    bind(classOf[AuthenticationController]).asEagerSingleton()
    bind(classOf[WebAuthnService]).asEagerSingleton()
  }
}
