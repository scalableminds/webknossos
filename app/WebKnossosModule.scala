import com.google.inject.AbstractModule
import controllers.InitialDataService

class WebKnossosModule extends AbstractModule {
  def configure() = {
    bind(classOf[Startup]).asEagerSingleton
    bind(classOf[InitialDataService]).asEagerSingleton
  }
}
