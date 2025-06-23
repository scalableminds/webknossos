package opengraph

import org.apache.pekko.http.scaladsl.model.Uri
import com.google.inject.Inject
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayerLike}
import models.annotation.AnnotationDAO
import models.dataset.{Dataset, DatasetDAO, DatasetLayerDAO}
import models.organization.{Organization, OrganizationDAO}
import models.shortlinks.ShortLinkDAO
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.Full
import security.URLSharing
import utils.WkConf

import scala.concurrent.ExecutionContext

case class OpenGraphTags(
    title: Option[String],
    description: Option[String],
    image: Option[String]
)

object OpenGraphPageType extends ExtendedEnumeration {
  val dataset, annotation, workflow, unknown = Value
}

class OpenGraphService @Inject()(datasetDAO: DatasetDAO,
                                 organizationDAO: OrganizationDAO,
                                 datasetLayerDAO: DatasetLayerDAO,
                                 annotationDAO: AnnotationDAO,
                                 shortLinkDAO: ShortLinkDAO,
                                 conf: WkConf)
    extends FoxImplicits {

  private val thumbnailWidth = 1000
  private val thumbnailHeight = 300

  // This should match the frontend-side routes, not api routes, since those are the links people send around
  private val shortLinkRouteRegex = "^/links/(.*)".r
  private val datasetRoute1Regex = "^/datasets/([^/^#]+)/view".r
  private val datasetRoute2Regex = "^/datasets/([^/^#]+)".r
  private val datasetRoute1LegacyRegex = "^/datasets/([^/^#]+)/([^/^#]+)/view".r
  private val datasetRoute2LegacyRegex = "^/datasets/([^/^#]+)/([^/^#]+)".r
  private val workflowRouteRegex = "^/workflows/([^/^#]+)".r
  private val annotationRouteRegex = "^/annotations/([^/^#]+)".r

  def getOpenGraphTags(uriPath: String, sharingToken: Option[String])(implicit ec: ExecutionContext,
                                                                      ctx: DBAccessContext): Fox[OpenGraphTags] =
    for {
      tagsBox <- getOpenGraphTagsImpl(uriPath, sharingToken).shiftBox
      // In any error case, fall back to default, so the html template does not break
      tags = tagsBox match {
        case Full(tags) => tags
        case _          => defaultTags(OpenGraphPageType.unknown)
      }
    } yield tags

  private def getOpenGraphTagsImpl(uriPath: String, sharingToken: Option[String])(
      implicit ec: ExecutionContext,
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
      tagsBox <- tagsFox.shiftBox
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
          asUri <- tryo(Uri(shortLink.longLink)).toFox
        } yield (asUri.path.toString, asUri.query().get("token").orElse(asUri.query().get("sharingToken")))
      case _ => Fox.successful(uriPath, sharingToken)
    }

  private def detectPageType(uriPath: String) =
    uriPath match {
      case datasetRoute1Regex(_, _) | datasetRoute2Regex(_, _) | datasetRoute1LegacyRegex(_, _) |
          datasetRoute2LegacyRegex(_, _) =>
        OpenGraphPageType.dataset
      case annotationRouteRegex(_) => OpenGraphPageType.annotation
      case workflowRouteRegex(_)   => OpenGraphPageType.workflow
      case _                       => OpenGraphPageType.unknown
    }

  private def datasetOpenGraphTags(uriPath: String, token: Option[String])(implicit ec: ExecutionContext,
                                                                           ctx: DBAccessContext): Fox[OpenGraphTags] =
    uriPath match {
      case datasetRoute1Regex(datasetIdStr) =>
        val validDatasetIdOpt = getDatasetIdFromURIPath(datasetIdStr)
        datasetOpenGraphTagsWithOrganizationId(validDatasetIdOpt, None, None, token)
      case datasetRoute2Regex(datasetIdStr) =>
        val validDatasetIdOpt = getDatasetIdFromURIPath(datasetIdStr)
        datasetOpenGraphTagsWithOrganizationId(validDatasetIdOpt, None, None, token)
      case datasetRoute1LegacyRegex(organizationId, datasetName) =>
        datasetOpenGraphTagsWithOrganizationId(None, Some(organizationId), Some(datasetName), token)
      case datasetRoute2LegacyRegex(organizationId, datasetName) =>
        datasetOpenGraphTagsWithOrganizationId(None, Some(organizationId), Some(datasetName), token)
      case _ => Fox.failure("not a matching uri")
    }

  private def getDatasetIdFromURIPath(datasetNameAndId: String): Option[ObjectId] = {
    // URIs contain the naming scheme of /datasets/<dataset_name>-<dataset_id>/view. This function extracts the dataset_id.
    // This should also work for /datasets/<dataset_id>/view.
    val idStrOpt = datasetNameAndId.split("-").lastOption
    val idOpt = idStrOpt.flatMap(ObjectId.fromStringSync)
    idOpt match {
      case Some(validId) => Some(validId)
      case None          => None
    }
  }

  private def datasetOpenGraphTagsWithOrganizationId(
      datasetIdOpt: Option[ObjectId],
      organizationIdOpt: Option[String],
      datasetNameOpt: Option[String],
      token: Option[String])(implicit ec: ExecutionContext, ctx: DBAccessContext) =
    for {
      dataset <- (datasetIdOpt, organizationIdOpt, datasetNameOpt) match {
        case (Some(datasetId), None, None) =>
          datasetDAO.findOne(datasetId)
        case (None, Some(organizationId), Some(datasetName)) =>
          datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)
        case _ => Fox.failure("Could not find dataset")
      }
      layers <- datasetLayerDAO.findAllForDataset(dataset._id)
      layerOpt = layers.find(_.category == Category.color)
      organization <- organizationDAO.findOne(dataset._organization)
    } yield
      OpenGraphTags(
        Some(s"${dataset.name} | WEBKNOSSOS"),
        Some("View this dataset in WEBKNOSSOS"),
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
          dataset: Dataset <- datasetDAO.findOne(annotation._dataset)
          organization <- organizationDAO.findOne(dataset._organization)
          layers <- datasetLayerDAO.findAllForDataset(dataset._id)
          layerOpt = layers.find(_.category == Category.color)
        } yield
          OpenGraphTags(
            Some(s"${annotation.nameOpt.getOrElse(dataset.name)} | WEBKNOSSOS"),
            Some(s"View this annotation on dataset ${dataset.name} in WEBKNOSSOS"),
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
      s"${conf.Http.uri}/api/datasets/${organization._id}/${dataset.name}/layers/${layer.name}/thumbnail?w=$thumbnailWidth&h=$thumbnailHeight$tokenParam"
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
