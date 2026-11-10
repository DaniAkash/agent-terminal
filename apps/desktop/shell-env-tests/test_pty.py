"""Exercise the production environment helpers and shell scripts in real PTYs."""

import argparse
import errno
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import shlex
import signal
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = (ROOT / "src-tauri/src/shell_integration.rs").read_text()


def executable(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    path.chmod(0o755)


def session(shell, env, home, expected):
    args = [shell]
    if Path(shell).name == "bash":
        script = re.search(r'const BASH_SCRIPT: &str = r#"(.*?)"#;', SCRIPTS, re.S)[1]
        init = home / "bash-integration.bash"
        init.write_text(script)
        args += ["--noprofile", "--rcfile", str(init), "-i"]
    elif Path(shell).name == "fish":
        script = re.search(r'const FISH_SCRIPT: &str = r#"(.*?)"#;', SCRIPTS, re.S)[1]
        init = home / "fish-integration.fish"
        init.write_text(script)
        env["AGENT_TERMINAL_FISH_INTEGRATION"] = str(init)
        args += ["--init-command", "source $AGENT_TERMINAL_FISH_INTEGRATION", "-i"]
    else:
        zdotdir = home / "zsh-integration"
        zdotdir.mkdir(exist_ok=True)
        for constant, filename in [("ZSH_ZSHENV_SHIM", ".zshenv"), ("ZSH_ZPROFILE_SHIM", ".zprofile"), ("ZSH_SCRIPT", ".zshrc")]:
            script = re.search(rf'const {constant}: &str = r#"(.*?)"#;', SCRIPTS, re.S)[1]
            (zdotdir / filename).write_text(script)
        env.update({"ZDOTDIR": str(zdotdir), "ZDOTDIR_ORIG": str(home)})
        args += ["-l", "-i"]
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(home)
        os.execve(shell, args, env)
    output = b""
    exited = False
    status = None
    try:
        os.write(fd, b"command -v codex\ncodex --version\nprintf '%s%s\\n' SESSION_ FINISHED\nexit\n")
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if select.select([fd], [], [], 0.2)[0]:
                try:
                    chunk = os.read(fd, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        _, status = os.waitpid(pid, 0)
                        exited = True
                        break
                    raise
                if not chunk:
                    break
                output += chunk
            result, child_status = os.waitpid(pid, os.WNOHANG)
            if result:
                exited = True
                status = child_status
                # Read any final output buffered by the PTY.
                while select.select([fd], [], [], 0)[0]:
                    try:
                        chunk = os.read(fd, 65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    output += chunk
                break
        text = output.decode(errors="replace")
        assert expected in text, f"{shell}: missing {expected!r}\n{text}"
        assert "SESSION_FINISHED" in text, f"{shell}: session did not finish"
        assert "not found" not in text, f"{shell}: command resolution failed\n{text}"
        assert exited and os.waitstatus_to_exitcode(status) == 0, f"{shell}: shell did not exit cleanly\n{text}"
    finally:
        if not exited:
            try:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
            except ProcessLookupError:
                pass
        os.close(fd)


def check(probe, shell, scenario):
    with tempfile.TemporaryDirectory(prefix="agent terminal env ") as temp:
        home = Path(temp)
        env = {"HOME": str(home), "PATH": "/usr/local/bin:/usr/bin:/bin", "TERM": "xterm-256color", "LANG": "C.UTF-8", "XDG_CONFIG_HOME": str(home / ".config")}
        expected = f"CODEX_FIXTURE_{scenario}"
        if scenario == "bun":
            target = home / ".cache/.bun/bin/codex"
        elif scenario == "npm":
            prefix = home / "custom npm"
            (home / ".npmrc").write_text(f"prefix={prefix}\n")
            target = prefix / "bin/codex"
        elif scenario == "custom":
            target = home / "manual tools/codex"
            config = home / ".config/agent-terminal/environment.json"
            config.parent.mkdir(parents=True)
            config.write_text(json.dumps({"extraPaths": ["~/manual tools"]}))
        else:
            target = home / ".local/bin/codex"
        if scenario in ("bun", "npm"):
            executable(target, f'#!/usr/bin/env node\nconsole.log("{expected}");\n')
        else:
            executable(target, f"#!/bin/sh\nprintf '{expected}\\n'\n")
        # A preselected/version-manager executable must win over fallbacks.
        if scenario in ("precedence", "startup"):
            preferred = home / "selected runtime/bin/codex"
            executable(preferred, "#!/bin/sh\nprintf 'CODEX_SELECTED_RUNTIME\\n'\n")
            if scenario == "precedence":
                env["PATH"] = f"{preferred.parent}:{env['PATH']}"
            else:
                for name in (".bashrc", ".zshrc"):
                    (home / name).write_text(f'export PATH={shlex.quote(str(preferred.parent))}:"$PATH"\n')
                config = home / ".config/fish/config.fish"
                config.parent.mkdir(parents=True, exist_ok=True)
                config.write_text(f'set -gx PATH {shlex.quote(str(preferred.parent))} $PATH\n')
            expected = "CODEX_SELECTED_RUNTIME"
        if scenario == "appimage":
            app = home / "AppDir"
            (app / "usr/lib").mkdir(parents=True)
            env.update({"APPDIR": str(app), "LD_LIBRARY_PATH": str(app / "usr/lib"), "PYTHONHOME": str(app / "usr"), "PYTHONPATH": str(app / "python")})
        changes = json.loads(subprocess.check_output([str(probe)], env=env))
        for key, value in changes.items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = value
        if scenario == "appimage":
            assert "LD_LIBRARY_PATH" not in env and "PYTHONHOME" not in env
        session(shell, env, home, expected)
        # A fresh PTY repeats the same startup path used by a shell respawn.
        session(shell, env, home, expected)
        print(f"PASS shell={Path(shell).name} scenario={scenario}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--shell", action="append", choices=["bash", "fish", "zsh"])
    args = parser.parse_args()
    for name in args.shell or ("bash", "fish", "zsh"):
        shell = shutil.which(name)
        if not shell:
            raise SystemExit(f"Required test shell missing: {name}")
        for scenario in ("standalone", "bun", "npm", "custom", "precedence", "startup", "appimage"):
            check(args.probe.resolve(), shell, scenario)
