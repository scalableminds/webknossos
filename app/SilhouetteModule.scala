import com.google.inject.{AbstractModule, Provides, TypeLiteral}
import com.mohiva.play.silhouette.api.repositories.AuthInfoRepository
import com.mohiva.play.silhouette.api.util.PasswordHasherRegistry
import com.mohiva.play.silhouette.api.{Environment, Silhouette, SilhouetteProvider}
import oxalis.security.{PasswordHasher, UserAuthInfoRepository, WkEnv, WkSilhouetteEnvironment}

class SilhouetteModule extends AbstractModule {
  def configure(): Unit = {
    bind(new TypeLiteral[Environment[WkEnv]] {}).to(new TypeLiteral[WkSilhouetteEnvironment] {})
    bind(new TypeLiteral[Silhouette[WkEnv]] {}).to(new TypeLiteral[SilhouetteProvider[WkEnv]] {})
    bind(new TypeLiteral[AuthInfoRepository] {}).to(new TypeLiteral[UserAuthInfoRepository] {})
    ()
  }

  @Provides
  def providePasswordHasherRegistry(): PasswordHasherRegistry =
    PasswordHasherRegistry(new PasswordHasher(), Seq.empty)
}
