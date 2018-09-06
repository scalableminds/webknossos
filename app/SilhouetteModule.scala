import com.google.inject.{AbstractModule, Provides}
import com.mohiva.play.silhouette.api.{Environment, Silhouette, SilhouetteProvider}
import oxalis.security.{WkEnv, WkSilhouetteEnvironment}

class SilhouetteModule extends AbstractModule {
  def configure(): Unit = {
    bind(classOf[Environment[WkEnv]]).to(classOf[WkSilhouetteEnvironment])
    bind(classOf[Silhouette[WkEnv]]).to(classOf[SilhouetteProvider[WkEnv]])
    ()
  }
}
