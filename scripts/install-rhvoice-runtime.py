#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DESTINATION = ROOT / "data" / "models" / "rhvoice-runtime"
RHVOICE_REPO = "https://github.com/RHVoice/RHVoice.git"
SUBMODULES = (
    "data/languages/Russian",
    "data/voices/anna",
    "data/voices/aleksandr",
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a local native RHVoice Russian runtime.")
    parser.add_argument("--destination", default=str(default_destination()), help="Runtime output directory.")
    parser.add_argument("--force", action="store_true", help="Replace the destination if it already exists.")
    parser.add_argument("--jobs", type=int, default=max(1, os.cpu_count() or 1), help="SCons parallel jobs.")
    args = parser.parse_args()

    destination = Path(args.destination).expanduser()
    if destination.exists():
        if not args.force:
            raise SystemExit(f"{destination} already exists; pass --force to rebuild it")
        shutil.rmtree(destination)

    with tempfile.TemporaryDirectory(prefix="rhvoice-build-") as tmp:
        source = Path(tmp) / "RHVoice"
        run(["git", "clone", "--depth", "1", RHVOICE_REPO, str(source)])
        external_libs = submodule_paths(source, "external/libs/")
        run(["git", "submodule", "update", "--init", "--depth", "1", "--", *external_libs, *SUBMODULES], cwd=source)
        run(["scons", "languages=Russian", "audio_libs=none", "dev=true", f"-j{args.jobs}"], cwd=source)
        install_runtime(source, destination)

    print(f"RHVoice runtime installed: {destination}")
    return 0


def submodule_paths(source: Path, prefix: str) -> list[str]:
    output = subprocess.check_output(["git", "config", "--file", ".gitmodules", "--get-regexp", "path"], cwd=source, text=True)
    paths = [line.split(maxsplit=1)[1] for line in output.splitlines()]
    return [path for path in paths if path.startswith(prefix)]


def install_runtime(source: Path, destination: Path) -> None:
    lib_dir = destination / "lib"
    data_dir = destination / "data"
    lib_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "languages").mkdir(parents=True, exist_ok=True)
    (data_dir / "voices").mkdir(parents=True, exist_ok=True)

    if platform.system() == "Darwin":
        for name in ("libRHVoice.5.4.0.dylib", "libRHVoice_core.10.3.0.dylib", "libRHVoice_audio.2.0.0.dylib"):
            shutil.copy2(source / "local" / "lib" / name, lib_dir / name)
        symlink_force("libRHVoice.5.4.0.dylib", lib_dir / "libRHVoice.dylib")
        symlink_force("libRHVoice_core.10.3.0.dylib", lib_dir / "libRHVoice_core.dylib")
        symlink_force("libRHVoice_audio.2.0.0.dylib", lib_dir / "libRHVoice_audio.dylib")
    else:
        for name in ("libRHVoice.so.5.4.0", "libRHVoice_core.so.10.3.0", "libRHVoice_audio.so.2.0.0"):
            shutil.copy2(source / "local" / "lib" / name, lib_dir / name)
        symlink_force("libRHVoice.so.5.4.0", lib_dir / "libRHVoice.so")
        symlink_force("libRHVoice.so.5.4.0", lib_dir / "libRHVoice.so.5")
        symlink_force("libRHVoice_core.so.10.3.0", lib_dir / "libRHVoice_core.so")
        symlink_force("libRHVoice_core.so.10.3.0", lib_dir / "libRHVoice_core.so.10")
        symlink_force("libRHVoice_audio.so.2.0.0", lib_dir / "libRHVoice_audio.so")
        symlink_force("libRHVoice_audio.so.2.0.0", lib_dir / "libRHVoice_audio.so.2")

    shutil.copytree(source / "data" / "languages" / "Russian", data_dir / "languages" / "Russian")
    shutil.copytree(source / "data" / "voices" / "anna", data_dir / "voices" / "anna")
    shutil.copytree(source / "data" / "voices" / "aleksandr", data_dir / "voices" / "aleksandr")

    if platform.system() == "Darwin":
        fix_macos_install_names(lib_dir)


def default_destination() -> Path:
    if platform.system() == "Linux":
        return DEFAULT_DESTINATION / f"linux-{platform.machine().lower()}"
    return DEFAULT_DESTINATION


def fix_macos_install_names(lib_dir: Path) -> None:
    core = lib_dir / "libRHVoice_core.10.3.0.dylib"
    audio = lib_dir / "libRHVoice_audio.2.0.0.dylib"
    main = lib_dir / "libRHVoice.5.4.0.dylib"
    run(["install_name_tool", "-id", "@loader_path/libRHVoice_core.10.3.0.dylib", str(core)])
    run(
        [
            "install_name_tool",
            "-id",
            "@loader_path/libRHVoice_audio.2.0.0.dylib",
            "-change",
            "build/darwin/core/libRHVoice_core.10.3.0.dylib",
            "@loader_path/libRHVoice_core.10.3.0.dylib",
            str(audio),
        ]
    )
    run(
        [
            "install_name_tool",
            "-id",
            "@loader_path/libRHVoice.5.4.0.dylib",
            "-change",
            "build/darwin/core/libRHVoice_core.10.3.0.dylib",
            "@loader_path/libRHVoice_core.10.3.0.dylib",
            str(main),
        ]
    )


def symlink_force(target: str, link: Path) -> None:
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(target)


def run(command: list[str], cwd: Path | None = None) -> None:
    subprocess.run(command, cwd=cwd, check=True)


if __name__ == "__main__":
    raise SystemExit(main())
