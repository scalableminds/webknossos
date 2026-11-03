import classnames from "classnames";
import { useWkSelector } from "libs/react_hooks";

/** Co-branding: shows the logo of the active organization's partner next to the WEBKNOSSOS logo. */
export function PartnerLogo({ compact }: { compact: boolean }) {
  const partner = useWkSelector((state) => state.activeOrganization?.partner);
  if (partner == null) return null;

  const logoUrl = compact ? (partner.compactLogoUrl ?? partner.logoUrl) : partner.logoUrl;
  const logo = (
    <img
      src={logoUrl}
      alt={partner.name}
      className={classnames("partner-logo", { compact: compact && partner.compactLogoUrl != null })}
    />
  );
  if (partner.linkUrl == null) return logo;
  return (
    <a href={partner.linkUrl} target="_blank" rel="noopener noreferrer" title={partner.name}>
      {logo}
    </a>
  );
}
