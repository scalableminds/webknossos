import proofreadingDendrites from "@images/vx/proofreading-dendrites.webp";
import AdCard from "admin/ads/ad_card";
import features from "features";

// Ad shown below the credit information of the "Run Segmentation Model" tab (webknossos.org only).

export function ProofreadingAd() {
  if (!features().isWkorgInstance) {
    return null;
  }
  return (
    <AdCard
      coverImage={{ src: proofreadingDendrites, alt: "Proofread dendrite segments" }}
      eyebrow="Proofreading"
      title="Proofread your segmentation."
      description="Fix split and merge errors on large segmentations with supervoxel-graph editing. Collaborative and near real time."
      ctaLabel="See proofreading tools"
      ctaHref="https://docs.webknossos.org/webknossos/proofreading/proofreading_tool.html"
    />
  );
}
