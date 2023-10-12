package play.modules.swagger

import com.typesafe.config.Config
import javax.annotation.Nullable
import play.api.Configuration

case class PlaySwaggerConfig(
    title: String,
    version: String,
    description: String,
    termsOfServiceUrl: String,
    contact: String,
    license: String,
    licenseUrl: String,
    host: String,
    basePath: String,
    schemes: Seq[String],
    filterClass: Option[String]
) {
  // Java APIs for reading the configuration
  def getSchemes: Array[String] = schemes.toArray
  @Nullable def getFilterClass: String = filterClass.orNull
}

object PlaySwaggerConfig {
  def defaultReference: PlaySwaggerConfig = PlaySwaggerConfig(Configuration.reference)

  def apply(configuration: Configuration): PlaySwaggerConfig =
    PlaySwaggerConfig(
      version = configuration.getOptional[String]("api.version").getOrElse("beta"),
      description = configuration.getOptional[String]("swagger.api.info.description").getOrElse(""),
      host = configuration.getOptional[String]("swagger.api.host").getOrElse("localhost:9000"),
      basePath = configuration.getOptional[String]("swagger.api.basepath").getOrElse("/"),
      schemes = configuration.getOptional[Seq[String]]("swagger.api.schemes").getOrElse(Seq.empty),
      title = configuration.get[String]("swagger.api.info.title"),
      contact = configuration.getOptional[String]("swagger.api.info.contact").getOrElse(""),
      termsOfServiceUrl = configuration.getOptional[String]("swagger.api.info.termsOfServiceUrl").getOrElse(""),
      license = configuration.getOptional[String]("swagger.api.info.license").getOrElse(""),
      licenseUrl = configuration.getOptional[String]("swagger.api.info.licenseUrl").getOrElse("http://licenseUrl"),
      filterClass = configuration.getOptional[String]("swagger.filter")
    )

  def apply(config: Config): PlaySwaggerConfig = apply(Configuration(config))
}
