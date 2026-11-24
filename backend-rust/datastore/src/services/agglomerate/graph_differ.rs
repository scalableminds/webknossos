//! Scala `AgglomerateGraphDiffer`: compares the graph of one agglomerate with the graph of one
//! agglomerate of a reference mapping (the reference agglomerate).
//!
//! - Added edges are all edges of the agglomerate that are not part of the reference graph. For
//!   a merge, this includes the merged-in parts (everything outside of the reference
//!   agglomerate).
//! - Removed edges are reference edges with at least one endpoint in the agglomerate that are not
//!   part of the agglomerate graph. For a split, the other endpoint lies outside of the
//!   agglomerate, so the edges are dangling and lead to the first segment outside of the
//!   agglomerate. The split-off parts are not included, as these might be huge.
//!
//! The edges are returned as plain lists. They are only shown in a local overlay, so in contrast
//! to annotation trees, they don't need to be split into connected components.
use std::collections::{HashMap, HashSet, hash_map::Entry};

use crate::{
    error::{DsError, DsResult},
    proto::{AgglomerateEdge, AgglomerateGraph, AgglomerateGraphDiff, datastore as pb},
};

/// Edges are undirected, so (a, b) and (b, a) map to the same key.
fn edge_key(edge: &AgglomerateEdge) -> (u64, u64) {
    // Scala compares the (signed) Long values.
    if (edge.source as i64) <= (edge.target as i64) {
        (edge.source, edge.target)
    } else {
        (edge.target, edge.source)
    }
}

/// Keeps the first edge per undirected key (Scala `distinctBy(edgeKey)`).
fn distinct_edges<'a>(
    edges: impl Iterator<Item = &'a AgglomerateEdge>,
) -> Vec<&'a AgglomerateEdge> {
    let mut seen = HashSet::new();
    edges.filter(|edge| seen.insert(edge_key(edge))).collect()
}

pub fn diff(
    graph: &AgglomerateGraph,
    reference_graph: &AgglomerateGraph,
    reference_agglomerate_id: u64,
) -> DsResult<AgglomerateGraphDiff> {
    // The reference agglomerate might be a huge merger, so only lookup structures for the
    // (smaller) part that touches the agglomerate are built. The reference graph itself is only
    // iterated over.
    let segment_ids: HashSet<u64> = graph.segments.iter().copied().collect();
    let edge_keys: HashSet<(u64, u64)> = graph.edges.iter().map(edge_key).collect();
    let reference_edges_touching_agglomerate: Vec<&AgglomerateEdge> = reference_graph
        .edges
        .iter()
        .filter(|edge| segment_ids.contains(&edge.source) || segment_ids.contains(&edge.target))
        .collect();
    let reference_edge_keys_touching_agglomerate: HashSet<(u64, u64)> =
        reference_edges_touching_agglomerate
            .iter()
            .map(|edge| edge_key(edge))
            .collect();

    // An edge of the agglomerate can only be part of the reference graph if it is one of the
    // reference edges that touch the agglomerate.
    let added_edges = distinct_edges(
        graph
            .edges
            .iter()
            .filter(|edge| !reference_edge_keys_touching_agglomerate.contains(&edge_key(edge))),
    );
    let removed_edges = distinct_edges(
        reference_edges_touching_agglomerate
            .iter()
            .copied()
            .filter(|edge| !edge_keys.contains(&edge_key(edge))),
    );

    let mut endpoint_segment_ids = Vec::new();
    let mut index_by_segment_id = HashMap::new();
    for edge in added_edges.iter().chain(&removed_edges) {
        for segment_id in [edge.source, edge.target] {
            if let Entry::Vacant(entry) = index_by_segment_id.entry(segment_id) {
                entry.insert(endpoint_segment_ids.len() as i32);
                endpoint_segment_ids.push(segment_id);
            }
        }
    }

    // Positions from the agglomerate graph take precedence, reference positions are only used for
    // the dangling ends of removed edges.
    let mut position_by_segment_id: HashMap<u64, &pb::Vec3IntProto> = HashMap::new();
    for source_graph in [reference_graph, graph] {
        for (segment_id, position) in source_graph.segments.iter().zip(&source_graph.positions) {
            if index_by_segment_id.contains_key(segment_id) {
                position_by_segment_id.insert(*segment_id, position);
            }
        }
    }

    let mut positions = Vec::with_capacity(endpoint_segment_ids.len() * 3);
    for segment_id in &endpoint_segment_ids {
        let position = position_by_segment_id.get(segment_id).ok_or_else(|| {
            DsError::failure(format!(
                "java.util.NoSuchElementException: key not found: {segment_id}"
            ))
        })?;
        positions.extend([position.x, position.y, position.z]);
    }
    let as_indices = |edges: &[&AgglomerateEdge]| -> Vec<i32> {
        edges
            .iter()
            .flat_map(|edge| {
                [
                    index_by_segment_id[&edge.source],
                    index_by_segment_id[&edge.target],
                ]
            })
            .collect()
    };

    Ok(AgglomerateGraphDiff {
        reference_agglomerate_id,
        positions,
        added_edges: as_indices(&added_edges),
        removed_edges: as_indices(&removed_edges),
    })
}

#[cfg(test)]
mod services_graph_differ_tests;
