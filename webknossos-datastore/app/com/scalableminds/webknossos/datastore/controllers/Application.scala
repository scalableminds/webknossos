package com.scalableminds.webknossos.datastore.controllers

import com.amazonaws.ClientConfiguration
import com.amazonaws.client.builder.AwsClientBuilder
import com.amazonaws.regions.Regions
import com.amazonaws.services.s3.AmazonS3ClientBuilder
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import com.upplication.s3fsfork.util.AnonymousAWSCredentialsProvider
import play.api.mvc.{Action, AnyContent}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class Application @Inject()(redisClient: DataStoreRedisStore)(implicit ec: ExecutionContext) extends Controller {

  override def allowRemoteOrigin: Boolean = true

  def health: Action[AnyContent] = Action.async { implicit request =>
    log() {
      for {
        before <- Fox.successful(System.currentTimeMillis())
        _ <- redisClient.checkHealth
        afterRedis = System.currentTimeMillis()
        _ = logger.info(s"Answering ok for Datastore health check, took ${afterRedis - before} ms")
      } yield Ok("Ok")
    }
  }

  def testS3: Action[AnyContent] = Action { implicit request =>
    val credentialsProvider = new AnonymousAWSCredentialsProvider
    val clientConfiguration = new ClientConfiguration
    val client = AmazonS3ClientBuilder
          .standard()
          .withCredentials(credentialsProvider)
          .withClientConfiguration(clientConfiguration)
          .withMetricsCollector(null)
          .withEndpointConfiguration(new AwsClientBuilder.EndpointConfiguration("s3.amazonaws.com", Regions.US_WEST_2.toString))
          .build()

    val o = client.getObject("power-analysis-ready-datastore", "power_901_annual_meteorology_utc.zarr/.zattrs")
    val c = o.getObjectContent()

    logger.info(client.toString)

      Ok
  }

}
