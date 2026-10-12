//! Scala `AxisOrder` helpers (the case class itself is `crate::models::AxisOrder`) and
//! `FullAxisOrder`.
//!
//! Two orderings are in play: "physical" (the on-disk dimension order declared by the data source;
//! `AxisOrder.x/y/z/c` and `AdditionalAxis.index` are physical indices) and "wk" (always
//! additionalAxes + (c)xyz).

use std::fmt;

use serde_json::{Map, Value};

use crate::error::{DsError, DsResult};
use crate::models::{AdditionalAxis, AxisOrder};

impl AxisOrder {
    pub const fn new(x: i32, y: i32, z: Option<i32>, c: Option<i32>) -> Self {
        Self { x, y, z, c }
    }

    /// Scala `AxisOrder.xyz(x, y, z)`.
    pub const fn xyz_at(x: i32, y: i32, z: i32) -> Self {
        Self::new(x, y, Some(z), None)
    }

    /// Scala `AxisOrder.xyz`.
    pub const XYZ: AxisOrder = AxisOrder::xyz_at(0, 1, 2);

    pub fn has_z_axis(&self) -> bool {
        self.z.is_some()
    }

    /// Scala `zWithFallback`: z is appended after the last axis for 2-d data.
    pub fn z_with_fallback(&self) -> i32 {
        match self.z {
            Some(z) => z,
            None => self.x.max(self.y).max(self.c.unwrap_or(-1)) + 1,
        }
    }

    /// Scala `length`.
    pub fn length(&self) -> usize {
        2 + 1 + usize::from(self.c.is_some())
    }

    /// Scala `asZyxFromRank`: the last three dimensions are z,y,x (OME-NGFF).
    pub fn as_zyx_from_rank(rank: i32) -> Self {
        Self::xyz_at(rank - 1, rank - 2, rank - 3)
    }

    /// Scala `asCxyzFromRank`: the last three dimensions are x,y,z, preceded by c for rank > 3.
    pub fn as_cxyz_from_rank(rank: i32) -> Self {
        if rank == 3 {
            Self::xyz_at(rank - 3, rank - 2, rank - 1)
        } else {
            Self::new(rank - 3, rank - 2, Some(rank - 1), Some(rank - 4))
        }
    }

    /// Scala `AxisOrder.cxyz`.
    pub fn cxyz() -> Self {
        Self::as_cxyz_from_rank(4)
    }

    /// Scala `cAdditionalxyz`: additional coordinates between c and xyz.
    pub fn c_additional_xyz(rank: i32) -> Self {
        Self::new(rank - 3, rank - 2, Some(rank - 1), Some(0))
    }
}

/// Scala `FullAxisOrder`: one axis name per physical dimension (full rank, plus the appended z
/// of the 2-d adapter). Unnamed slots (`""`) are treated like additional axes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FullAxisOrder {
    axes: Vec<String>,
    /// `physicalToWkPermutation(wkSlot)` = physical index.
    physical_to_wk: Vec<usize>,
    /// `wkToPhysicalPermutation(physicalIndex)` = wk slot.
    wk_to_physical: Vec<usize>,
}

fn index_error(index: i64, rank: usize) -> DsError {
    let message = format!("Index {index} out of bounds for length {rank}");
    DsError {
        exception: Some(format!(
            "java.lang.ArrayIndexOutOfBoundsException: {message}"
        )),
        ..DsError::failure(message)
    }
}

impl FullAxisOrder {
    /// Scala `FullAxisOrder(axes)`. Fails like Scala (`ArrayIndexOutOfBoundsException`) when the
    /// rank is too small for the named axes (e.g. `c` with rank < 4).
    pub fn new(axes: Vec<String>) -> DsResult<Self> {
        let rank = axes.len();
        let mut physical_to_wk = vec![0usize; rank];
        let mut additional_axis_index = 0usize;
        let slot = |offset: usize| -> DsResult<usize> {
            rank.checked_sub(offset)
                .ok_or_else(|| index_error(rank as i64 - offset as i64, rank))
        };
        for (index, name) in axes.iter().enumerate() {
            let target = match name.as_str() {
                "z" => slot(1)?,
                "y" => slot(2)?,
                "x" => slot(3)?,
                "c" => slot(4)?,
                _ => {
                    let target = additional_axis_index;
                    additional_axis_index += 1;
                    target
                }
            };
            if target >= rank {
                return Err(index_error(target as i64, rank));
            }
            physical_to_wk[target] = index;
        }
        let mut wk_to_physical = vec![0usize; rank];
        for (wk_slot, &physical) in physical_to_wk.iter().enumerate() {
            wk_to_physical[physical] = wk_slot;
        }
        Ok(Self {
            axes,
            physical_to_wk,
            wk_to_physical,
        })
    }

    /// Scala `FullAxisOrder.fromAxisOrderAndAdditionalAxes`.
    pub fn from_axis_order_and_additional_axes(
        rank: usize,
        axis_order: &AxisOrder,
        additional_axes: Option<&[AdditionalAxis]>,
    ) -> DsResult<Self> {
        let mut axes = vec![String::new(); rank];
        let mut set = |index: i32, name: &str| -> DsResult<()> {
            let slot = usize::try_from(index)
                .ok()
                .filter(|i| *i < rank)
                .ok_or_else(|| index_error(i64::from(index), rank))?;
            axes[slot] = name.to_string();
            Ok(())
        };
        set(axis_order.x, "x")?;
        set(axis_order.y, "y")?;
        if let Some(c) = axis_order.c {
            set(c, "c")?;
        }
        if let Some(z) = axis_order.z {
            set(z, "z")?;
        }
        if !axis_order.has_z_axis() {
            set(rank as i32 - 1, "z")?;
        }
        for axis in additional_axes.unwrap_or_default() {
            set(axis.index, &axis.name)?;
        }
        Self::new(axes)
    }

    pub fn axes(&self) -> &[String] {
        &self.axes
    }

    pub fn rank(&self) -> usize {
        self.axes.len()
    }

    /// Scala `axesWk`.
    pub fn axes_wk(&self) -> Vec<&str> {
        self.physical_to_wk
            .iter()
            .map(|&i| self.axes[i].as_str())
            .collect()
    }

    /// Scala `toStringWk`.
    pub fn to_string_wk(&self) -> String {
        self.axes_wk().concat()
    }

    /// Scala `physicalToWkPermutation`.
    pub fn physical_to_wk_permutation(&self) -> &[usize] {
        &self.physical_to_wk
    }

    /// Scala `physicalFToWkFPermutation`.
    pub fn physical_f_to_wk_f_permutation(&self) -> Vec<usize> {
        let rank = self.rank();
        self.physical_to_wk
            .iter()
            .rev()
            .map(|&e| rank - 1 - e)
            .collect()
    }

    /// Scala `physicalCToWkFPermutation`.
    pub fn physical_c_to_wk_f_permutation(&self) -> Vec<usize> {
        self.physical_to_wk.iter().rev().copied().collect()
    }

    pub fn wk_slot_of_physical_index(&self, physical_index: usize) -> usize {
        self.wk_to_physical[physical_index]
    }

    pub fn physical_index_of_wk_slot(&self, wk_slot: usize) -> usize {
        self.physical_to_wk[wk_slot]
    }

    /// Scala `permuteIndicesWkToPhysical` (gather through the inverse permutation).
    pub fn permute_indices_wk_to_physical<T: Copy>(&self, indices: &[T]) -> Vec<T> {
        self.wk_to_physical.iter().map(|&i| indices[i]).collect()
    }

    /// Scala `permuteIndicesPhysicalToWk`.
    pub fn permute_indices_physical_to_wk<T: Copy>(&self, indices: &[T]) -> Vec<T> {
        self.physical_to_wk.iter().map(|&i| indices[i]).collect()
    }

    /// Scala `toWkLibsJson`: `{x: i, y: j, z: k}` in physical order.
    pub fn to_wk_libs_json(&self) -> Value {
        let mut map = Map::new();
        for (index, name) in self.axes.iter().enumerate() {
            if matches!(name.as_str(), "x" | "y" | "z") {
                map.insert(name.clone(), Value::from(index));
            }
        }
        Value::Object(map)
    }
}

impl fmt::Display for FullAxisOrder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.axes.concat())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn axis_order_helpers() {
        assert_eq!(AxisOrder::as_zyx_from_rank(3), AxisOrder::xyz_at(2, 1, 0));
        assert_eq!(AxisOrder::as_cxyz_from_rank(3), AxisOrder::XYZ);
        assert_eq!(AxisOrder::cxyz(), AxisOrder::new(1, 2, Some(3), Some(0)));
        let two_d = AxisOrder::new(1, 0, None, Some(2));
        assert_eq!(two_d.z_with_fallback(), 3);
        assert_eq!(two_d.length(), 4);
        assert_eq!(
            AxisOrder::c_additional_xyz(5),
            AxisOrder::new(2, 3, Some(4), Some(0))
        );
    }

    #[test]
    fn full_axis_order_zyx_with_additional_axis() {
        // physical: t, c, z, y, x
        let axis_order = AxisOrder::new(4, 3, Some(2), Some(1));
        let additional = [AdditionalAxis {
            name: "t".into(),
            bounds: vec![0, 10],
            index: 0,
        }];
        let full =
            FullAxisOrder::from_axis_order_and_additional_axes(5, &axis_order, Some(&additional))
                .unwrap();
        assert_eq!(full.to_string(), "tczyx");
        assert_eq!(full.to_string_wk(), "tcxyz");
        assert_eq!(full.physical_to_wk_permutation(), &[0, 1, 4, 3, 2]);
        assert_eq!(full.wk_slot_of_physical_index(4), 2);
        assert_eq!(
            full.permute_indices_physical_to_wk(&[1, 2, 3, 4, 5]),
            vec![1, 2, 5, 4, 3]
        );
        assert_eq!(
            full.permute_indices_wk_to_physical(&[1, 2, 5, 4, 3]),
            vec![1, 2, 3, 4, 5]
        );
        assert_eq!(full.physical_c_to_wk_f_permutation(), vec![2, 3, 4, 1, 0]);
        assert_eq!(full.physical_f_to_wk_f_permutation(), vec![2, 1, 0, 3, 4]);
        assert_eq!(
            full.to_wk_libs_json(),
            serde_json::json!({"z": 2, "y": 3, "x": 4})
        );
    }

    #[test]
    fn full_axis_order_2d_adapter_and_errors() {
        let full = FullAxisOrder::from_axis_order_and_additional_axes(
            3,
            &AxisOrder::new(1, 0, None, None),
            None,
        )
        .unwrap();
        assert_eq!(full.to_string(), "yxz");
        assert!(
            FullAxisOrder::from_axis_order_and_additional_axes(3, &AxisOrder::cxyz(), None)
                .is_err()
        );
    }
}
