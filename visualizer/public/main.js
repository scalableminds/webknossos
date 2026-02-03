/* ================================
   Global state
================================ */

let versions = [];
let activeIndex = 0;

const sidebar = document.getElementById("sidebar");
const main = document.getElementById("main");
const main2 = document.getElementById("main2");
const segmentViewDiv = document.getElementById("segment-view")

/* ================================
   Load once
================================ */

fetch("/versions")
  .then(res => res.json())
  .then(data => {
    versions = data;
    buildSidebar();
    renderVersion(0);
  });

/* ================================
   Sidebar
================================ */

function buildSidebar() {
  sidebar.innerHTML = "";

  versions.forEach((v, i) => {
    const entry = document.createElement("div");
    entry.textContent = `Version ${v.version}`;
    entry.onclick = () => {
      activeIndex = i;
      renderVersion(i);
      updateActive();
    };
    sidebar.appendChild(entry);
  });

  updateActive();


  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      activeIndex = (activeIndex + 1) % versions.length;
      renderVersion(activeIndex);
      updateActive();
      e.preventDefault();
    }

    if (e.key === "ArrowUp") {
      activeIndex = (activeIndex - 1 + versions.length) % versions.length;
      renderVersion(activeIndex);
      updateActive();
      e.preventDefault();
    }
  });

}

function updateActive() {
  [...sidebar.children].forEach((el, i) =>
    el.classList.toggle("active", i === activeIndex)
  );
}

/* ================================
   Helpers
================================ */

function parseAdjacencyList(json) {
  const data = JSON.parse(json);

  return new Map(
    data.map(([key, values]) => [key, new Set(values)])
  );
}

function layoutComponentsWithDagre(nodes, links, nodeIdToComponentId, width, height) {
  const components = d3.group(nodes, d => nodeIdToComponentId(d.id));

  const GAP_X = 200;
  let cursorX = 0;

  const allPositions = [];

  // stable order (VERY IMPORTANT)
  const sorted = [...components.entries()]
    .sort((a, b) => a[0] - b[0]); // by agglomerate id

  let componentIndex = -1
  for (const [_aggId, compNodes] of sorted) {
    componentIndex++;
    const compSet = new Set(compNodes.map(n => n.id));

    const compLinks = links.filter(
      l => compSet.has(l.source) && compSet.has(l.target)
    );

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "LR",
      nodesep: 50,
      edgesep: 50,
      ranksep: 100,
    });

    g.setDefaultEdgeLabel(() => ({}));

    compNodes.forEach(n =>
      g.setNode(n.id, { width: 50, height: 50 })
    );

    compLinks.forEach(l =>
      g.setEdge(l.source, l.target)
    );

    dagre.layout(g);

    // compute component bbox
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    compNodes.forEach(n => {
      const pos = g.node(n.id);
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    });

    const w = maxX - minX;

    // shift into row layout
    compNodes.forEach(n => {
      const pos = g.node(n.id);
      n.x = pos.x - minX + cursorX;
      n.y = pos.y + 20 * componentIndex;

      allPositions.push(n);
    });

    cursorX += w + GAP_X;
  }

  // -------- center entire layout (fix top-left problem)

  const xs = nodes.map(n => n.x);
  const ys = nodes.map(n => n.y);

  const graphW = Math.max(...xs) - Math.min(...xs);
  const graphH = Math.max(...ys) - Math.min(...ys);

  const offsetX = (width - graphW) / 2 - Math.min(...xs);
  const offsetY = (height - graphH) / 2 - Math.min(...ys);

  nodes.forEach(n => {
    n.x += offsetX;
    n.y += offsetY;
  });
}



/* ================================
   Main render with transitions
================================ */

function parseDiffableMap(obj) {
  return new Map(obj.entries);
}

function renderVersion(index) {
  const { versionMap: versionMapJSON, adjacencyList: adjacencyListJSON, storeState: storeStateOriginal, saveRequests } =
    versions[index];

  const storeState = JSON.parse(JSON.stringify(storeStateOriginal), (key, value) => {
    return value != null && typeof value === "object" && value._isDiffableMap ? parseDiffableMap(value) : value;
  })

  const trees = storeState.annotation.skeleton.trees;

  console.log("saveRequests", saveRequests);
  document.getElementById("action-log-area").value = JSON
    .stringify(saveRequests, null, "\t")
    .replaceAll(
      "],\n\t\"",
      "],\n\n\t\""
    );

  const segments = storeState.annotation.volumes[0].segments;
  console.log("segments", segments);

  const tableHTML = `
  <table>
    <thead>
      <tr>
        <th style='width: 100px'>ID</th>
        <th style='width: 100px'>Name</th>
        <th style='width: 100px'>Anchor</th>
      </tr>
    </thead>
    <tbody>
      ${Array.from(segments.values()).map(s => `
        <tr>
          <td>${s.id}</td>
          <td>${s.name}</td>
          <td>${JSON.stringify(s.anchorPosition)}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
  `;

  segmentViewDiv.innerHTML = tableHTML;

  const versionMap = new Map(
    Object.entries(versionMapJSON).map(([k, v]) => [Number(k), v])
  );

  const adjacencyList = parseAdjacencyList(adjacencyListJSON);


  /* ---------- build nodes/links ---------- */

  function renderAgglomerateGraph() {
    const nodes = [...versionMap.keys()].map(id => ({ id }));

    const links = [];
    for (const [from, tos] of adjacencyList.entries()) {
      tos.forEach(to => {
        links.push({ source: from, target: to });
      });
    }
    const segments = new Map(storeState.annotation.volumes[0].segments);
    const nodeIdToComponentId = nodeId => versionMap.get(nodeId);
    const componentIdToColor = id => segments.has(id) ? "green" : "gray";
    const componentIdToLabel = id => `Agglomerate ${id}`;

    aggloRenderer.renderGraph(nodes, links, nodeIdToComponentId, componentIdToColor, componentIdToLabel)
  }

  function renderSkeletonGraph() {
    const treeByNodeId = new Map();
    const treeByTreeId = new Map();

    for (const tree of trees.values()) {
      for (const node of tree.nodes.values()) {
        treeByNodeId.set(node.id, tree)
        treeByTreeId.set(tree.treeId, tree)
      }
    }


    const nodes = [...trees.values().flatMap(tree => tree.nodes.values())].map(node => ({ id: node.id }));
    console.log("nodes", nodes)

    const links = [];
    for (const tree of trees.values()) {
      for (const edge of tree.edges.outMap.values()) {
        links.push({ source: edge[0].source, target: edge[0].target })
      }
    }
    const nodeIdToComponentId = nodeId => treeByNodeId.get(nodeId).treeId;
    const componentIdToColor = _id => "gray";
    const componentIdToLabel = id => `${treeByTreeId.get(id).name} (${id})`;

    skeletonRenderer.renderGraph(nodes, links, nodeIdToComponentId, componentIdToColor, componentIdToLabel)
  }

  renderAgglomerateGraph();
  renderSkeletonGraph();
}

class GraphRenderer {
  constructor(parentDiv) {
    /* keep positions between renders for smooth morphing */
    this.previousPositions = new Map();


    this.svg = d3
      .select(parentDiv)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%");

    this.svg.append("defs")
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 40)
      .attr("refY", 0)
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("markerUnits", "strokeWidth")
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#999");

    /* layer order matters */
    this.componentLayer = this.svg.append("g");
    this.componentLabelLayer = this.svg.append("g");
    this.linkLayer = this.svg.append("g");
    this.nodeLayer = this.svg.append("g");
  }

  renderGraph(nodes, links, nodeIdToComponentId, componentIdToColor, componentIdToLabel) {
    const width = main.clientWidth;
    const height = main.clientHeight;
    const nodeById = new Map(nodes.map(n => [n.id, n]));

    links.forEach(l => {
      l.source = nodeById.get(l.source);
      l.target = nodeById.get(l.target);
    });


    /* ---------- seed previous positions ---------- */

    nodes.forEach(n => {
      const prev = this.previousPositions.get(n.id);
      if (prev) {
        n.x = prev.x;
        n.y = prev.y;
      }
    });

    /* ---------- simulate offscreen ---------- */

    layoutComponentsWithDagre(nodes, links, nodeIdToComponentId, width, height);



    /* save positions for next render */
    nodes.forEach(n =>
      this.previousPositions.set(n.id, { x: n.x, y: n.y })
    );

    /* ---------- group components ---------- */

    const components = d3.group(nodes, d => nodeIdToComponentId(d.id));

    const compData = [...components.entries()].map(([aggId, compNodes]) => {
      const pad = 50;
      const xs = compNodes.map(d => d.x);
      const ys = compNodes.map(d => d.y);

      return {
        id: aggId,
        x: Math.min(...xs) - pad,
        y: Math.min(...ys) - pad,
        w: Math.max(...xs) - Math.min(...xs) + 2 * pad,
        h: Math.max(...ys) - Math.min(...ys) + 2 * pad
      };
    });

    const t = this.svg.transition().duration(600);

    /* ================================
       COMPONENT RECTANGLES
    ================================ */

    this.componentLayer
      .selectAll("rect")
      .data(compData, d => d.id)
      .join(
        enter => enter.append("rect").attr("opacity", 0),
        update => update,
        exit => exit.transition(t).attr("opacity", 0).remove()
      )
      .transition(t)
      .attr("opacity", 1)
      .attr("x", d => d.x)
      .attr("y", d => d.y)
      .attr("width", d => d.w)
      .attr("height", d => d.h)
      .attr("rx", 12)
      .attr("ry", 12)
      .attr("fill", "none")
      .attr("stroke", "#666")
      .attr("stroke-dasharray", "4 2");

    this.componentLabelLayer
      .selectAll("text")
      .data(compData, d => d.id)
      .join(
        enter => enter.append("text").attr("opacity", 0),
        update => update,
        exit => exit.transition(t).attr("opacity", 0).remove()
      )
      .transition(t)
      .attr("opacity", 1)
      .attr("x", d => d.x + 6)
      .attr("y", d => d.y - 6)
      .attr("font-size", 14)
      .attr("font-family", "sans-serif")
      .attr("fill", d => componentIdToColor(d.id))
      .text(d => componentIdToLabel(d.id));

    /* ================================
       LINKS
    ================================ */

    const linkSel = this.linkLayer
      .selectAll("line")
      .data(links, d => `${d.source.id}->${d.target.id}`);


    linkSel.exit()
      .transition()
      .style("opacity", 0)
      .remove();


    const linkEnter = linkSel.enter()
      .append("line")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .attr("marker-end", "url(#arrow)")
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    const line = d3.line()
      .x(d => d.x)
      .y(d => d.y)
      .curve(d3.curveBundle.beta(0.5)); // makes edges curved

    linkSel.merge(linkEnter)
      .transition()
      .duration(600)
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);
    /* ================================
       NODES
    ================================ */

    const nodeSel = this.nodeLayer
      .selectAll("g.node")
      .data(nodes, d => d.id);

    nodeSel.exit()
      .transition(t)
      .style("opacity", 0)
      .remove();

    const nodeEnter = nodeSel.enter()
      .append("g")
      .attr("class", "node")
      .style("opacity", 0);

    nodeEnter.append("circle")
      .attr("r", 25)
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5);

    nodeEnter.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", 20)
      .attr("pointer-events", "none");

    const nodeMerged = nodeEnter.merge(nodeSel);

    nodeMerged.select("circle")
      .attr("fill", "gray");

    nodeMerged.select("text")
      .text(d => d.id);

    nodeMerged
      .transition(t)
      .style("opacity", 1)
      .attr("transform", d => `translate(${d.x}, ${d.y})`);
  }
}

const aggloRenderer = new GraphRenderer(main)
const skeletonRenderer = new GraphRenderer(main2)
