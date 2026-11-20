use std::{fs::File, path::Path, sync::Arc};

use anyhow::{Context, Result};
use parquet::{
    file::reader::{FileReader, SerializedFileReader},
    record::{Field, Row},
    schema::types::Type,
};

pub(crate) type Stamp = (u32, usize);

pub(crate) fn array_member<'a>(name: &'a str, prefix: &str) -> Option<(u32, &'a str)> {
    let (slot, member) = name.strip_prefix(prefix)?.split_once("].")?;
    Some((slot.parse().ok()?, member))
}

pub(crate) fn read_rows(
    directory: &Path,
    file: &str,
    columns: &[&str],
    mut visit: impl FnMut(usize, Row) -> Result<()>,
) -> Result<()> {
    let path = directory.join(file);
    (|| -> Result<()> {
        let reader = SerializedFileReader::new(File::open(&path)?)?;
        let root = reader.metadata().file_metadata().schema();
        let fields = columns
            .iter()
            .map(|name| {
                root.get_fields()
                    .iter()
                    .find(|field| field.name() == *name)
                    .cloned()
                    .with_context(|| format!("missing column {name}"))
            })
            .collect::<Result<Vec<Arc<Type>>>>()?;
        let projection = Type::group_type_builder(root.name())
            .with_fields(fields)
            .build()?;
        for (index, row) in reader.get_row_iter(Some(projection))?.enumerate() {
            visit(index, row?).with_context(|| format!("row {}", index + 1))?;
        }
        Ok(())
    })()
    .with_context(|| format!("reading {}", path.display()))
}

pub(crate) trait Column {
    fn column(&self, name: &str) -> &Field;

    fn text(&self, name: &str) -> Option<&str> {
        match self.column(name) {
            Field::Str(value) => Some(value),
            _ => None,
        }
    }

    fn integer(&self, name: &str) -> Option<i64> {
        match self.column(name) {
            Field::Long(value) => Some(*value),
            Field::UInt(value) => Some(i64::from(*value)),
            Field::Int(value) => Some(i64::from(*value)),
            _ => None,
        }
    }

    fn u32(&self, name: &str) -> Option<u32> {
        self.integer(name)?.try_into().ok()
    }

    fn double(&self, name: &str) -> Option<f64> {
        match self.column(name) {
            Field::Double(value) => Some(*value),
            _ => None,
        }
    }

    fn boolean(&self, name: &str) -> Option<bool> {
        match self.column(name) {
            Field::Bool(value) => Some(*value),
            _ => None,
        }
    }
}

impl Column for Row {
    fn column(&self, name: &str) -> &Field {
        self.get_column_iter()
            .find_map(|(key, value)| (key == name).then_some(value))
            .unwrap_or(&Field::Null)
    }
}
