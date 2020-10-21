import com.google.inject.AbstractModule
import com.scalableminds.webknossos.datastore.services.DataSourceService
import controllers.InitialDataService
import models.annotation.AnnotationStore
import models.binary.DataSetService
import models.task.TaskService
import models.user._
import models.user.time.TimeSpanService
import oxalis.user.UserCache
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
    bind(classOf[DataSourceService]).asEagerSingleton()
    bind(classOf[TimeSpanService]).asEagerSingleton()
  }
}
