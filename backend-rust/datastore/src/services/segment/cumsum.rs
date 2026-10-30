//! Scala CumsumParser/BoundingBoxCache range selection for HDF5 agglomerate mappings.
use crate::{
    error::{DsError, DsResult},
    models::data_requests::DataServiceDataRequest,
};
use std::{
    collections::{BTreeSet, HashMap},
    path::Path,
};
type Point = [i64; 3];
#[derive(Clone, Copy)]
struct Entry {
    start: u64,
    end: u64,
    dimensions: Point,
}
pub struct Cumsum {
    entries: HashMap<Point, Entry>,
    coordinates: [BTreeSet<i64>; 3],
    minimum: Point,
}
impl Cumsum {
    pub fn read(path: &Path) -> DsResult<Self> {
        let bytes = std::fs::read(path).map_err(DsError::from_exception)?;
        let json: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(DsError::from_exception)?;
        let keys = json["max_ids"]
            .as_object()
            .ok_or_else(|| DsError::failure("Invalid cumsum max_ids."))?;
        let sums = json["cumsum"]
            .as_array()
            .ok_or_else(|| DsError::failure("Invalid cumsum array."))?;
        if keys.is_empty() || keys.len() != sums.len() {
            return Err(DsError::failure("Invalid cumsum bounding-box count."));
        }
        let mut names = keys.keys().collect::<Vec<_>>();
        names.sort();
        let mut entries = HashMap::new();
        let mut coordinates: [BTreeSet<i64>; 3] = std::array::from_fn(|_| BTreeSet::new());
        let mut previous = 0u64;
        for (name, sum) in names.into_iter().zip(sums) {
            if keys[name].as_i64().is_none() {
                return Err(DsError::failure("Invalid cumsum max id."));
            }
            let mut parts = Vec::new();
            for part in name.split('_') {
                if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
                    return Err(DsError::failure("Invalid cumsum bounding-box name."));
                }
                parts.push(part.parse::<i64>().map_err(DsError::from_exception)?);
            }
            let [x, y, z, w, h, d] = parts[..] else {
                return Err(DsError::failure("Invalid cumsum bounding-box dimensions."));
            };
            if w <= 0 || h <= 0 || d <= 0 {
                return Err(DsError::failure("Cumsum dimensions must be positive."));
            }
            let end = sum
                .as_i64()
                .filter(|n| *n >= 0)
                .ok_or_else(|| DsError::failure("Invalid cumsum id range."))?
                as u64;
            if end < previous {
                return Err(DsError::failure("Inverted cumsum id range."));
            }
            let point = [x, y, z];
            for (axis, n) in point.into_iter().enumerate() {
                coordinates[axis].insert(n);
            }
            if entries
                .insert(
                    point,
                    Entry {
                        start: previous + 1,
                        end,
                        dimensions: [w, h, d],
                    },
                )
                .is_some()
            {
                return Err(DsError::failure("Duplicate cumsum bounding box."));
            }
            previous = end;
        }
        let minimum = *entries.keys().min().expect("nonempty entries");
        Ok(Self {
            entries,
            coordinates,
            minimum,
        })
    }
    pub fn range(&self, request: &DataServiceDataRequest) -> DsResult<(u64, u64)> {
        let requested = request.cuboid.mag1_bounding_box()?;
        let top = requested.top_left.to_array().map(i64::from);
        let bottom = requested.bottom_right().to_array().map(i64::from);
        let layer_bottom = request
            .data_layer
            .bounding_box
            .bottom_right()
            .to_array()
            .map(i64::from);
        let initial = std::array::from_fn(|axis| {
            self.coordinates[axis]
                .range(..=top[axis])
                .next_back()
                .copied()
                .unwrap_or(self.minimum[axis])
        });
        let start = self
            .entries
            .get(&initial)
            .ok_or_else(|| DsError::failure("Cumsum initial bounding box is missing."))?;
        let mut range = (start.start, start.end);
        let mut dimensions = start.dimensions;
        let [mut x, mut y, mut z] = initial;
        let advance = |n: i64, d: i64| {
            n.checked_add(d)
                .ok_or_else(|| DsError::failure("Cumsum coordinate overflow."))
        };
        let mut visits = 0usize;
        while x < bottom[0] && x < layer_bottom[0] {
            let next_x = [advance(x, dimensions[0])?, y, z];
            dimensions[1] = start.dimensions[1];
            while y < bottom[1] && y < layer_bottom[1] {
                let next_y = [x, advance(y, dimensions[1])?, z];
                dimensions[2] = start.dimensions[2];
                while z < bottom[2] && z < layer_bottom[2] {
                    visits += 1;
                    if visits > 10_000_000 {
                        return Err(DsError::failure("Cumsum range walk exceeds limit."));
                    }
                    if let Some(entry) = self.entries.get(&[x, y, z]) {
                        range = (range.0.min(entry.start), range.1.max(entry.end));
                        dimensions = entry.dimensions;
                    }
                    z = advance(z, dimensions[2])?;
                }
                y = next_y[1];
                z = next_y[2];
            }
            x = next_x[0];
            y = next_x[1];
            z = next_x[2];
        }
        Ok(range)
    }
}
