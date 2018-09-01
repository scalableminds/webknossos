import com.google.inject.AbstractModule
import controllers.InitialDataService
import models.user._
import oxalis.user.UserCache
import utils.SQLClient

class WebKnossosModule extends AbstractModule {
  def configure() = {
    bind(classOf[Startup]).asEagerSingleton
    bind(classOf[SQLClient]).asEagerSingleton
    bind(classOf[InitialDataService]).asEagerSingleton
    bind(classOf[UserService]).asEagerSingleton
    bind(classOf[UserDAO]).asEagerSingleton
    bind(classOf[UserTeamRolesDAO]).asEagerSingleton
    bind(classOf[UserExperiencesDAO]).asEagerSingleton
    bind(classOf[UserDataSetConfigurationDAO]).asEagerSingleton
    bind(classOf[UserCache]).asEagerSingleton
  }
}
