import com.google.inject.AbstractModule

class WebKnossosModule extends AbstractModule {
  def configure() = {
    bind(classOf[Startup]).asEagerSingleton
  }
}
