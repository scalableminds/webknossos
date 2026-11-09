import classnames from "classnames";
import { useWkSelector } from "libs/react_hooks";

/** Co-branding: shows the logo of the active organization's partner next to the WEBKNOSSOS logo. */
export function PartnerLogo({ compact }: { compact: boolean }) {
  const partner = useWkSelector((state) => state.activeOrganization?.partner);
  if (partner == null) return null;

  const compactLogoUrl = compact ? partner.compactLogoUrl : null;
  const showsCompactLogo = compactLogoUrl != null;
  // Phones have no room for a full logo. The class goes on the outermost element so that a
  // surrounding link is hidden, too.
  const hideOnPhonesClass = { "partner-logo-hidden-on-phones": !showsCompactLogo };
  const logo = (
    <img
      src={compactLogoUrl ?? partner.logoUrl}
      alt={partner.name}
      className={classnames("partner-logo", {
        compact: showsCompactLogo,
        // Without a compact variant, the full logo is shrunk to fit the collapsed navbar.
        "compact-fallback": compact && !showsCompactLogo,
        ...(partner.linkUrl == null ? hideOnPhonesClass : {}),
      })}
    />
  );
  return (
    <>
      <span
        className={classnames("partner-logo-divider", { compact }, hideOnPhonesClass)}
        aria-hidden
      />
      {partner.linkUrl == null ? (
        logo
      ) : (
        <a
          href={partner.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={partner.name}
          className={classnames(hideOnPhonesClass)}
        >
          {logo}
        </a>
      )}
    </>
  );
}
