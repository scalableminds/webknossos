import com.google.inject.{AbstractModule, Provides, TypeLiteral}
import play.silhouette.api.repositories.AuthInfoRepository
import play.silhouette.api.util.PasswordHasherRegistry
import play.silhouette.api.{Environment, Silhouette, SilhouetteProvider}
import security.{PasswordHasher, UserAuthInfoRepository, WkEnv, WkSilhouetteEnvironment}

class SilhouetteModule extends AbstractModule {
  override def configure(): Unit = {
    bind(new TypeLiteral[Environment[WkEnv]] {}).to(new TypeLiteral[WkSilhouetteEnvironment] {})
    bind(new TypeLiteral[Silhouette[WkEnv]] {}).to(new TypeLiteral[SilhouetteProvider[WkEnv]] {})
    bind(new TypeLiteral[AuthInfoRepository] {}).to(new TypeLiteral[UserAuthInfoRepository] {})
    ()
  }

  @Provides
  def providePasswordHasherRegistry(): PasswordHasherRegistry =
    PasswordHasherRegistry(new PasswordHasher(), Seq.empty)
}
