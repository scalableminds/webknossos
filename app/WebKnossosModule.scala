import com.google.inject.AbstractModule
import controllers.InitialDataService
import models.analytics.AnalyticsSessionService
import models.annotation.AnnotationStore
import models.binary.DataSetService
import models.job.{JobService, WorkerLivenessService}
import models.storage.UsedStorageService
import models.task.TaskService
import models.user.time.TimeSpanService
import models.user._
import models.voxelytics.ElasticsearchClient
import oxalis.files.TempFileService
import oxalis.mail.MailchimpTicker
import oxalis.telemetry.SlackNotificationService
import utils.SQLClient

class WebKnossosModule extends AbstractModule {
  override def configure(): Unit = {
    bind(classOf[Startup]).asEagerSingleton()
    bind(classOf[SQLClient]).asEagerSingleton()
    bind(classOf[InitialDataService]).asEagerSingleton()
    bind(classOf[UserService]).asEagerSingleton()
    bind(classOf[TaskService]).asEagerSingleton()
    bind(classOf[UserDAO]).asEagerSingleton()
    bind(classOf[UserExperiencesDAO]).asEagerSingleton()
    bind(classOf[UserDataSetConfigurationDAO]).asEagerSingleton()
    bind(classOf[UserCache]).asEagerSingleton()
    bind(classOf[AnnotationStore]).asEagerSingleton()
    bind(classOf[DataSetService]).asEagerSingleton()
    bind(classOf[TimeSpanService]).asEagerSingleton()
    bind(classOf[TempFileService]).asEagerSingleton()
    bind(classOf[MailchimpTicker]).asEagerSingleton()
    bind(classOf[JobService]).asEagerSingleton()
    bind(classOf[SlackNotificationService]).asEagerSingleton()
    bind(classOf[AnalyticsSessionService]).asEagerSingleton()
    bind(classOf[WorkerLivenessService]).asEagerSingleton()
    bind(classOf[ElasticsearchClient]).asEagerSingleton()
    bind(classOf[UsedStorageService]).asEagerSingleton()
  }
}
