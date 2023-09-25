package oxalis.opengraph

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayerLike}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationDAO
import models.binary.{Dataset, DatasetDAO, DatasetLayerDAO}
import models.organization.{Organization, OrganizationDAO}
import models.voxelytics.VoxelyticsDAO
import net.liftweb.common.Full
import oxalis.security.URLSharing
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext

case class OpenGraphTags(
    title: Option[String],
    description: Option[String],
    image: Option[String]
)

object OpenGraphTags {
  def default: OpenGraphTags = OpenGraphTags(
    Some("WEBKNOSSOS"),
    None,
    None
  )
}

class OpenGraphService @Inject()(voxelyticsDAO: VoxelyticsDAO,
                                 datasetDAO: DatasetDAO,
                                 organizationDAO: OrganizationDAO,
                                 datasetLayerDAO: DatasetLayerDAO,
                                 annotationDAO: AnnotationDAO,
                                 conf: WkConf)
    extends LazyLogging {

  def getOpenGraphTags(uriPath: String, uriToken: Option[String])(implicit ec: ExecutionContext,
                                                                  ctx: DBAccessContext): Fox[OpenGraphTags] = {
    val ctxWithToken = URLSharing.fallbackTokenAccessContext(uriToken)

    val pageType = detectPageType(uriPath)

    val tagsFox = pageType match {
      case OpenGraphPageType.dataset    => datasetOpenGraphTags(uriPath, uriToken)(ec, ctxWithToken)
      case OpenGraphPageType.annotation => annotationOpenGraphTags(uriPath, uriToken)(ec, ctxWithToken)
      case OpenGraphPageType.workflow   => workflowOpenGraphTags(uriPath)
      case OpenGraphPageType.unknown    => Fox.successful(OpenGraphTags.default)
    }

    // In error case (probably no access permissions), fall back to default, so the html template does not break
    for {
      tagsBox <- tagsFox.futureBox
      tags = tagsBox match {
        case Full(tags) => tags
        case _          => OpenGraphTags.default
      }
    } yield tags
  }

  private def detectPageType(uriPath: String) =
    uriPath match {
      case datasetRoute1Regex(_, _) | datasetRoute2Regex(_, _) => OpenGraphPageType.dataset
      case annotationRouteRegex(_)                             => OpenGraphPageType.annotation
      case workflowRouteRegex(_)                               => OpenGraphPageType.workflow
      case _                                                   => OpenGraphPageType.unknown
    }

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
      case _ => Fox.successful(OpenGraphTags.default)
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
        Some(s"View this dataset of organization ${organization.displayName} in WEBKNOSSOS"),
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
            Some(s"Annotation on dataset ${dataset.displayName.getOrElse(dataset.name)} in WEBKNOSSOS"),
            thumbnailUri(dataset, layerOpt, organization, token)
          )
      case _ => Fox.successful(OpenGraphTags.default)
    }

  private def thumbnailUri(dataset: Dataset,
                           layerOpt: Option[DataLayerLike],
                           organization: Organization,
                           token: Option[String]): Option[String] =
    layerOpt match {
      case Some(layer) if dataset.isPublic =>
        val tokenParam = token.map(t => s"&token=$t").getOrElse("")
        Some(
          s"${conf.Http.uri}/api/datasets/${organization.name}/${dataset.name}/layers/${layer.name}/thumbnail?w=1000&h=300$tokenParam")
      case _ => None
    }

  private def workflowOpenGraphTags(uriPath: String): Fox[OpenGraphTags] =
    uriPath match {
      case workflowRouteRegex(workflowHash: String) =>
        for { // TODO access check
          workflow <- voxelyticsDAO.findWorkflowByHash(workflowHash)
        } yield OpenGraphTags(Some(f"${workflow.name} | WEBKNOSSOS"), Some("Voxelytics Workflow Report"), None)
    }
}
