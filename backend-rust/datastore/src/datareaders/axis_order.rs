//! Scala `FullAxisOrder` (the `AxisOrder` case class and its helpers live in
//! `webknossos_common::datasource`).
//!
//! Two orderings are in play: "physical" (the on-disk dimension order declared by the data source;
//! `AxisOrder.x/y/z/c` and `AdditionalAxis.index` are physical indices) and "wk" (always
//! additionalAxes + (c)xyz).

use std::fmt;

use serde_json::{Map, Value};

use crate::error::{DsError, DsResult};
use crate::models::{AdditionalAxis, AxisOrder};

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
mod datareaders_axis_order_tests;
