import segmentationEmOverlay from "@images/vx/segmentation-em-overlay.webp";
import AdCard from "admin/ads/ad_card";
import features from "features";

export default function VoxelyticsBanner() {
  if (!features().isWkorgInstance) {
    return null;
  }

  return (
    <div className="hide-on-small-screen" style={{ width: 300, flexShrink: 0 }}>
      <AdCard
        coverImage={{ src: segmentationEmOverlay, alt: "Automated segmentation of an EM dataset" }}
        eyebrow="AI add-on"
        title="Segment and align this dataset yourself."
        description="The AI add-on lets you train segmentation models on your datasets. Fit custom models to your data, directly in WEBKNOSSOS."
        ctaLabel="Explore the AI add-on"
        ctaHref="https://webknossos.org/pricing"
        footnote="Credit-based · Available to Team & Power Plan"
      />
    </div>
  );
}
