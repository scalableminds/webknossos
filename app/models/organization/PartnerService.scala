package models.organization

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.box.{Failure, Full}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import play.api.libs.json.{JsObject, Json}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class PartnerService @Inject() (partnerDAO: PartnerDAO)(implicit ec: ExecutionContext) {

  def publicWrites(partner: Partner): JsObject =
    Json.obj(
      "id" -> partner._id,
      "name" -> partner.name,
      "logoUrl" -> partner.logoUrl,
      "compactLogoUrl" -> partner.compactLogoUrl,
      "linkUrl" -> partner.linkUrl
    )

  // Partner branding is not secret, so it is read with GlobalAccessContext to also show it to anonymous users.
  // A partner that cannot be found (e.g. soft-deleted) counts as no partner, so the organization stays readable.
  def findPartnerOf(organization: Organization): Fox[Option[Partner]] =
    Fox
      .runOptional(organization._partner)(partnerId =>
        partnerDAO.findOne(partnerId)(using GlobalAccessContext).shiftBox
      )
      .flatMap {
        case Some(Full(partner)) => Fox.successful(Some(partner))
        case Some(f: Failure)    => f.toFox
        case _                   => Fox.successful(None)
      }
}
