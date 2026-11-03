import { useWkSelector } from "libs/react_hooks";

/** Co-branding: shows the logo of the active organization's partner next to the WEBKNOSSOS logo. */
export function PartnerLogo() {
  const partner = useWkSelector((state) => state.activeOrganization?.partner);
  if (partner == null) return null;

  const logo = <img src={partner.logoUrl} alt={partner.name} className="partner-logo" />;
  if (partner.linkUrl == null) return logo;
  return (
    <a href={partner.linkUrl} target="_blank" rel="noopener noreferrer" title={partner.name}>
      {logo}
    </a>
  );
}
