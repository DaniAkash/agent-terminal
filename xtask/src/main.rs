// Project-level task runner. Follows the wider Rust community's
// `cargo xtask` convention: a small binary crate that holds project-level
// scripts (codegen, deploy hooks, release automation) written in Rust
// instead of shell / Make / justfile. Ergonomic via `cargo xtask …` thanks
// to the alias in `.cargo/config.toml`.

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Parser)]
#[command(name = "xtask", about = "Project-level task runner")]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Regenerate the TypeScript wire-protocol bindings from
    /// `src-tauri/src/protocol.rs`. Run this after editing that file so
    /// `companion/src/modules/wss/protocol.gen.ts` stays in sync.
    RegenProtocol,
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Cmd::RegenProtocol => regen_protocol(),
    }
}

fn regen_protocol() -> Result<()> {
    let root = repo_root()?;
    let input_dir = root.join("src-tauri").join("src");
    let output = root
        .join("companion")
        .join("src")
        .join("modules")
        .join("wss")
        .join("protocol.gen.ts");

    // The output directory may not exist on a fresh clone — the companion's
    // src/modules/wss/ tree is populated by later sub-steps. Create it up
    // front so typeshare can write into it either way.
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("mkdir {}", parent.display()))?;
    }

    run("typeshare", &[
        input_dir.as_os_str().to_str().unwrap(),
        "--lang",
        "typescript",
        "--output-file",
        output.to_str().unwrap(),
    ])
    .context(
        "failed to invoke typeshare CLI — install with `cargo install typeshare-cli --locked`",
    )?;

    // Format the generated file so the committed version matches biome's
    // expectations exactly. Without this step the drift check would flip
    // red whenever a developer's biome version formats slightly
    // differently from typeshare's output.
    //
    // Invoke biome directly from `companion/node_modules/.bin/biome`
    // rather than through `bunx --bun @biomejs/biome@<version>`. bunx
    // resolves via a temporary lockfile that touches the network + the
    // per-runner bunx cache; on CI this occasionally produced a
    // slightly different biome instance from what a local `bun install`
    // materialises, tripping the drift check even when the wire types
    // matched. The direct binary path is fully deterministic: whatever
    // `companion/package.json` pins is what runs. Prerequisites: run
    // `bun install` in `companion/` before invoking this xtask.
    let companion_dir = root.join("companion");
    let biome_bin = companion_dir
        .join("node_modules")
        .join(".bin")
        .join("biome");
    if !biome_bin.exists() {
        bail!(
            "biome binary not found at {}. Run `bun install` in companion/ first.",
            biome_bin.display()
        );
    }
    run_in(
        &companion_dir,
        biome_bin.to_str().unwrap(),
        &["format", "--write", output.to_str().unwrap()],
    )
    .context("failed to invoke biome")?;

    println!("✓ regenerated {}", output.display());
    Ok(())
}

fn run(program: &str, args: &[&str]) -> Result<()> {
    run_in(&repo_root()?, program, args)
}

fn run_in(cwd: &Path, program: &str, args: &[&str]) -> Result<()> {
    let status = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .status()
        .with_context(|| format!("spawn `{program}`"))?;
    if !status.success() {
        bail!("`{program}` exited with status {status}");
    }
    Ok(())
}

fn repo_root() -> Result<PathBuf> {
    // Walk up from CARGO_MANIFEST_DIR (== xtask/) one level to the
    // workspace root. Every subcommand needs this anchor for input +
    // output path resolution.
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let root = PathBuf::from(manifest_dir)
        .parent()
        .context("xtask has no parent directory — unexpected layout")?
        .to_path_buf();
    Ok(root)
}
