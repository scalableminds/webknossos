import com.google.inject.AbstractModule

class Module extends AbstractModule {
  def configure() = {
    bind(classOf[Startup]).asEagerSingleton
  }
}
