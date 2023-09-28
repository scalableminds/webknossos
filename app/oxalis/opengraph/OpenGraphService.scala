package oxalis.opengraph

import akka.http.scaladsl.model.Uri
import com.google.inject.Inject
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayerLike}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationDAO
import models.binary.{Dataset, DatasetDAO, DatasetLayerDAO}
import models.organization.{Organization, OrganizationDAO}
import models.shortlinks.ShortLinkDAO
import models.voxelytics.VoxelyticsDAO
import net.liftweb.common.Full
import oxalis.security.URLSharing
import java.net.URLDecoder
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext

case class OpenGraphTags(
    title: Option[String],
    description: Option[String],
    image: Option[String]
)

object OpenGraphPageType extends ExtendedEnumeration {
  val dataset, annotation, workflow, unknown = Value
}

class OpenGraphService @Inject()(voxelyticsDAO: VoxelyticsDAO,
                                 datasetDAO: DatasetDAO,
                                 organizationDAO: OrganizationDAO,
                                 datasetLayerDAO: DatasetLayerDAO,
                                 annotationDAO: AnnotationDAO,
                                 shortLinkDAO: ShortLinkDAO,
                                 conf: WkConf)
    extends LazyLogging {

  def getOpenGraphTags(uriPath: String, sharingToken: Option[String])(implicit ec: ExecutionContext,
                                                                      ctx: DBAccessContext): Fox[OpenGraphTags] =
    for {
      (uriPathResolved, sharingTokenResolved) <- resolveShortLinkIfNeeded(uriPath, sharingToken)
      ctxWithToken = URLSharing.fallbackTokenAccessContext(sharingTokenResolved)
      pageType = detectPageType(uriPathResolved)
      tagsFox = pageType match {
        case OpenGraphPageType.dataset => datasetOpenGraphTags(uriPathResolved, sharingTokenResolved)(ec, ctxWithToken)
        case OpenGraphPageType.annotation =>
          annotationOpenGraphTags(uriPathResolved, sharingTokenResolved)(ec, ctxWithToken)
        case OpenGraphPageType.workflow =>
          Fox.successful(defaultTags(OpenGraphPageType.workflow)) // No sharing token mechanism for workflows yet
        case OpenGraphPageType.unknown => Fox.successful(defaultTags())
      }
      // In error case (probably no access permissions), fall back to default, so the html template does not break
      tagsBox <- tagsFox.futureBox
      tags = tagsBox match {
        case Full(tags) => tags
        case _          => defaultTags(pageType)
      }
    } yield tags

  private def resolveShortLinkIfNeeded(uriPath: String, sharingToken: Option[String])(
      implicit ec: ExecutionContext): Fox[(String, Option[String])] =
    uriPath match {
      case shortLinkRouteRegex(key) =>
        for {
          shortLink <- shortLinkDAO.findOneByKey(key)
          _ = logger.info(shortLink.longLink)
          asUri: Uri = Uri(URLDecoder.decode(shortLink.longLink, "UTF-8"))
        } yield (asUri.path.toString, asUri.query().get("token").orElse(asUri.query().get("sharingToken")))
      case _ => Fox.successful(uriPath, sharingToken)
    }

  private def detectPageType(uriPath: String) =
    uriPath match {
      case datasetRoute1Regex(_, _) | datasetRoute2Regex(_, _) => OpenGraphPageType.dataset
      case annotationRouteRegex(_)                             => OpenGraphPageType.annotation
      case workflowRouteRegex(_)                               => OpenGraphPageType.workflow
      case _                                                   => OpenGraphPageType.unknown
    }

  private val shortLinkRouteRegex = "^/links/(.*)".r
  private val datasetRoute1Regex = "^/datasets/([^/^#]+)/([^/^#]+)/view".r
  private val datasetRoute2Regex = "^/datasets/([^/^#]+)/([^/^#]+)".r
  private val workflowRouteRegex = "^/workflows/([^/^#]+)".r
  private val annotationRouteRegex = "^/annotations/([^/^#]+)".r

  private def datasetOpenGraphTags(uriPath: String, token: Option[String])(implicit ec: ExecutionContext,
                                                                           ctx: DBAccessContext): Fox[OpenGraphTags] =
    uriPath match {
      case datasetRoute1Regex(organizationName, datasetName) =>
        datasetOpenGraphTagsWithOrganizationName(organizationName, datasetName, token)
      case datasetRoute2Regex(organizationName, datasetName) =>
        datasetOpenGraphTagsWithOrganizationName(organizationName, datasetName, token)
      case _ => Fox.failure("not a matching uri")
    }

  private def datasetOpenGraphTagsWithOrganizationName(organizationName: String,
                                                       datasetName: String,
                                                       token: Option[String])(implicit ctx: DBAccessContext) =
    for {
      dataset <- datasetDAO.findOneByNameAndOrganizationName(datasetName, organizationName)
      layers <- datasetLayerDAO.findAllForDataset(dataset._id)
      layerOpt = layers.find(_.category == Category.color)
      organization <- organizationDAO.findOne(dataset._organization)
    } yield
      OpenGraphTags(
        Some(s"${dataset.displayName.getOrElse(datasetName)} | WEBKNOSSOS"),
        Some(s"View this dataset in WEBKNOSSOS"),
        thumbnailUri(dataset, layerOpt, organization, token)
      )

  private def annotationOpenGraphTags(uriPath: String, token: Option[String])(
      implicit ec: ExecutionContext,
      ctx: DBAccessContext): Fox[OpenGraphTags] =
    uriPath match {
      case annotationRouteRegex(annotationId) =>
        for {
          annotationIdValidated <- ObjectId.fromString(annotationId)
          annotation <- annotationDAO.findOne(annotationIdValidated)
          dataset: Dataset <- datasetDAO.findOne(annotation._dataSet)
          organization <- organizationDAO.findOne(dataset._organization)
          layers <- datasetLayerDAO.findAllForDataset(dataset._id)
          layerOpt = layers.find(_.category == Category.color)
        } yield
          OpenGraphTags(
            Some(s"${annotation.nameOpt.orElse(dataset.displayName).getOrElse(dataset.name)} | WEBKNOSSOS"),
            Some(s"View this annotation on dataset ${dataset.displayName.getOrElse(dataset.name)} in WEBKNOSSOS"),
            thumbnailUri(dataset, layerOpt, organization, token)
          )
      case _ => Fox.failure("not a matching uri")
    }

  private def thumbnailUri(dataset: Dataset,
                           layerOpt: Option[DataLayerLike],
                           organization: Organization,
                           token: Option[String]): Option[String] =
    layerOpt.map { layer =>
      val tokenParam = token.map(t => s"&sharingToken=$t").getOrElse("")
      s"${conf.Http.uri}/api/datasets/${organization.name}/${dataset.name}/layers/${layer.name}/thumbnail?w=1000&h=300$tokenParam"
    }

  private def defaultTags(pageType: OpenGraphPageType.Value = OpenGraphPageType.unknown): OpenGraphTags = {
    val description = pageType match {
      case OpenGraphPageType.dataset    => Some("View this dataset in WEBKNOSSOS")
      case OpenGraphPageType.annotation => Some("View this annotation in WEBKNOSSOS")
      case OpenGraphPageType.workflow   => Some("View this voxelytics workflow report in WEBKNOSSOS")
      case _                            => None // most clients will fall back to <meta name="description">, see template
    }
    OpenGraphTags(
      Some("WEBKNOSSOS"),
      description,
      None
    )
  }
}
