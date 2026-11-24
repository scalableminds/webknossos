//! Mirrors Scala `AgglomerateGraphDifferTestSuite`.
use std::collections::BTreeSet;

use super::diff;
use crate::proto::{AgglomerateEdge, AgglomerateGraph, AgglomerateGraphDiff, datastore as pb};

/// The positions encode the segment ids, so that the endpoints of the edges can be identified.
fn position(segment_id: u64) -> pb::Vec3IntProto {
    let id = segment_id as i32;
    pb::Vec3IntProto {
        x: id,
        y: 2 * id,
        z: 3 * id,
    }
}

fn graph(segments: &[u64], edges: &[(u64, u64)]) -> AgglomerateGraph {
    AgglomerateGraph {
        segments: segments.to_vec(),
        edges: edges
            .iter()
            .map(|&(source, target)| AgglomerateEdge { source, target })
            .collect(),
        positions: segments.iter().copied().map(position).collect(),
        affinities: edges.iter().map(|_| 1.0).collect(),
    }
}

fn endpoint_segment_ids(result: &AgglomerateGraphDiff) -> Vec<u64> {
    result.positions.chunks(3).map(|p| p[0] as u64).collect()
}

fn checked_diff(graph: &AgglomerateGraph, reference: &AgglomerateGraph) -> AgglomerateGraphDiff {
    let result = diff(graph, reference, 7).unwrap();
    assert_eq!(result.reference_agglomerate_id, 7);
    assert_eq!(result.positions.len() % 3, 0);
    let ids = endpoint_segment_ids(&result);
    assert_eq!(ids.iter().collect::<BTreeSet<_>>().len(), ids.len());
    for (segment_id, p) in ids.iter().zip(result.positions.chunks(3)) {
        let id = *segment_id as i32;
        assert_eq!(p, [id, 2 * id, 3 * id]);
    }
    result
}

/// Converts the flat index pairs back to undirected edges between segment ids.
fn edges_as_segment_ids(result: &AgglomerateGraphDiff, indices: &[i32]) -> BTreeSet<BTreeSet<u64>> {
    let ids = endpoint_segment_ids(result);
    indices
        .chunks(2)
        .map(|pair| pair.iter().map(|i| ids[*i as usize]).collect())
        .collect()
}

fn set(edges: &[(u64, u64)]) -> BTreeSet<BTreeSet<u64>> {
    edges.iter().map(|&(a, b)| [a, b].into()).collect()
}

fn added_and_removed(
    g: &AgglomerateGraph,
    reference: &AgglomerateGraph,
) -> (BTreeSet<BTreeSet<u64>>, BTreeSet<BTreeSet<u64>>) {
    let result = checked_diff(g, reference);
    (
        edges_as_segment_ids(&result, &result.added_edges),
        edges_as_segment_ids(&result, &result.removed_edges),
    )
}

#[test]
fn identical_graphs_regardless_of_edge_direction() {
    let result = checked_diff(
        &graph(&[1, 2, 3], &[(1, 2), (2, 3)]),
        &graph(&[1, 2, 3], &[(2, 1), (3, 2)]),
    );
    assert!(result.added_edges.is_empty());
    assert!(result.removed_edges.is_empty());
    assert!(result.positions.is_empty());
}

#[test]
fn merge_reports_merging_edge_and_merged_in_part_as_added() {
    let (added, removed) = added_and_removed(
        &graph(&[1, 2, 3, 4], &[(1, 2), (2, 3), (3, 4)]),
        &graph(&[1, 2], &[(1, 2)]),
    );
    // Edge 3-4 belongs to the merged-in reference agglomerate
    assert_eq!(added, set(&[(2, 3), (3, 4)]));
    assert!(removed.is_empty());
}

#[test]
fn split_reports_splitting_edge_as_removed() {
    let result = checked_diff(
        &graph(&[1, 2], &[(1, 2)]),
        &graph(&[1, 2, 3, 4], &[(1, 2), (2, 3), (3, 4)]),
    );
    assert!(result.added_edges.is_empty());
    // Edge 3-4 belongs to the other part of the split and is not reported
    assert_eq!(
        edges_as_segment_ids(&result, &result.removed_edges),
        set(&[(2, 3)])
    );
    // The position of the dangling end is taken from the reference graph
    assert_eq!(
        endpoint_segment_ids(&result)
            .into_iter()
            .collect::<BTreeSet<_>>(),
        [2, 3].into()
    );
}

#[test]
fn merging_and_splitting_edges() {
    let result = checked_diff(
        &graph(&[1, 2, 5], &[(1, 2), (2, 5)]),
        &graph(&[1, 2, 3], &[(1, 2), (2, 3)]),
    );
    assert_eq!(
        edges_as_segment_ids(&result, &result.added_edges),
        set(&[(2, 5)])
    );
    assert_eq!(
        edges_as_segment_ids(&result, &result.removed_edges),
        set(&[(2, 3)])
    );
    // Segment 2 is an endpoint of both edges, but is only listed once
    let mut ids = endpoint_segment_ids(&result);
    ids.sort_unstable();
    assert_eq!(ids, [2, 3, 5]);
}

#[test]
fn disconnected_added_edges() {
    let (added, removed) = added_and_removed(
        &graph(
            &[1, 2, 3, 4, 5, 6],
            &[(1, 2), (2, 3), (3, 4), (4, 5), (5, 6)],
        ),
        &graph(&[1, 2, 3, 4, 5, 6], &[(1, 2), (3, 4), (5, 6)]),
    );
    assert_eq!(added, set(&[(2, 3), (4, 5)]));
    assert!(removed.is_empty());
}

#[test]
fn duplicate_edges_only_once() {
    let result = checked_diff(&graph(&[1, 2], &[(1, 2), (2, 1)]), &graph(&[1, 2], &[]));
    assert_eq!(result.added_edges.len(), 2);
}

#[test]
fn rewired_edges_within_the_same_agglomerate() {
    let (added, removed) = added_and_removed(
        &graph(&[1, 2, 3], &[(1, 2), (1, 3)]),
        &graph(&[1, 2, 3], &[(1, 2), (2, 3)]),
    );
    assert_eq!(added, set(&[(1, 3)]));
    assert_eq!(removed, set(&[(2, 3)]));
}
