use std::{
    env,
    ffi::OsStr,
    path::{Path, PathBuf},
    process::ExitCode,
};

use anyhow::{Result, bail};

const USAGE: &str = "\
vltv export <replay.vrf> <new-output-dir> [vrfkit-executable]
vltv from-parquet <vrfkit-export-dir> <new-output-dir>";

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error:#}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<()> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    let (export, destination) = match args.as_slice() {
        [help] if help == "--help" || help == "-h" => {
            println!("{USAGE}");
            return Ok(());
        }
        [command, tables, destination] if command == "from-parquet" => (
            vltv::read_vrfkit_export(Path::new(tables), None)?,
            destination,
        ),
        [command, replay, destination, rest @ ..] if command == "export" && rest.len() <= 1 => {
            let executable = rest
                .first()
                .cloned()
                .or_else(|| env::var_os("VRFKIT"))
                .unwrap_or_else(|| OsStr::new("vrfkit").to_owned());
            (
                vltv::read_replay(&PathBuf::from(executable), Path::new(replay))?,
                destination,
            )
        }
        _ => bail!("{USAGE}"),
    };
    let kills = export.write(Path::new(destination))?;
    println!(
        "Exported {} rounds and {kills} kill snapshots to {}",
        export.timelines.len(),
        Path::new(destination).display()
    );
    Ok(())
}
