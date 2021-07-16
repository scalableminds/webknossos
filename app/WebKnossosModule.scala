import com.google.inject.AbstractModule
import controllers.InitialDataService
import models.analytics.AnalyticsSessionService
import models.job.JobService
import models.annotation.AnnotationStore
import models.binary.DataSetService
import models.task.TaskService
import models.user.{UserCache, _}
import models.user.time.TimeSpanService
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
    bind(classOf[UserTeamRolesDAO]).asEagerSingleton()
    bind(classOf[UserExperiencesDAO]).asEagerSingleton()
    bind(classOf[UserDataSetConfigurationDAO]).asEagerSingleton()
    bind(classOf[UserCache]).asEagerSingleton()
    bind(classOf[AnnotationStore]).asEagerSingleton()
    bind(classOf[DataSetService]).asEagerSingleton()
    bind(classOf[TimeSpanService]).asEagerSingleton()
    bind(classOf[JobService]).asEagerSingleton()
    bind(classOf[SlackNotificationService]).asEagerSingleton()
    bind(classOf[AnalyticsSessionService]).asEagerSingleton()
  }
}
