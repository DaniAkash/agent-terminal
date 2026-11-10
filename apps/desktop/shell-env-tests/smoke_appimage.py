"""Check packaged GUI startup under an isolated X11 or Wayland desktop."""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time


def stop(process):
    if process is not None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def x11_lifecycle(app):
    """Use one display and D-Bus session for both launches and the close."""
    window_manager = subprocess.Popen(["openbox"], start_new_session=True)
    first = subprocess.Popen([str(app)], start_new_session=True)
    second = None
    reopened = None
    try:
        for _ in range(450):
            if first.poll() is not None:
                raise RuntimeError(f"App exited during startup: {first.returncode}")
            found = subprocess.run(
                ["xdotool", "search", "--onlyvisible", "--name", "Agent Terminal"],
                capture_output=True, text=True,
            )
            if found.returncode == 0 and found.stdout.strip():
                window = found.stdout.splitlines()[0]
                break
            time.sleep(0.1)
        else:
            subprocess.run(["xdotool", "search", "--onlyvisible", "--name", ".", "getwindowname"], check=False)
            raise RuntimeError("Main window did not appear")
        # Wait for the webview to attach its close listener after window creation.
        time.sleep(5)
        second = subprocess.Popen([str(app)], start_new_session=True)
        if second.wait(timeout=15) != 0 or first.poll() is not None:
            raise RuntimeError("Second launch did not activate the running instance")
        subprocess.run(["xdotool", "windowactivate", "--sync", window], check=True, timeout=10)
        subprocess.run(["xdotool", "key", "alt+F4"], check=True)
        if first.wait(timeout=15) != 0:
            raise RuntimeError("App did not exit cleanly after closing its window")
        reopened = subprocess.Popen([str(app)], start_new_session=True)
        for _ in range(450):
            if reopened.poll() is not None:
                raise RuntimeError(f"App failed to reopen: {reopened.returncode}")
            found = subprocess.run(
                ["xdotool", "search", "--onlyvisible", "--name", "Agent Terminal"],
                capture_output=True, text=True,
            )
            if found.returncode == 0 and found.stdout.strip():
                break
            time.sleep(0.1)
        else:
            subprocess.run(["xdotool", "search", "--onlyvisible", "--name", ".", "getwindowname"], check=False)
            raise RuntimeError("Main window did not reappear")
        print("PASS X11 second launch, window close, exit, and reopen")
    finally:
        stop(second)
        stop(first)
        stop(reopened)
        stop(window_manager)


def smoke(image, binary, backend):
    with tempfile.TemporaryDirectory(prefix="agent-image-smoke-") as temp:
        root = Path(temp)
        env = {"HOME": str(root), "PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8", "XDG_RUNTIME_DIR": str(root / "runtime"), "LIBGL_ALWAYS_SOFTWARE": "1", "WEBKIT_DISABLE_DMABUF_RENDERER": "1"}
        (root / "runtime").mkdir(mode=0o700)
        if image:
            subprocess.run([str(image), "--appimage-extract"], cwd=root, env=env, check=True, stdout=subprocess.DEVNULL)
            app = root / "squashfs-root/AppRun"
        else:
            app = binary
        command = ["dbus-run-session", "--", str(app)]
        compositor = process = None
        with (root / "startup.log").open("w+") as log:
            try:
                if backend == "wayland":
                    env.update({"WAYLAND_DISPLAY": "agent-terminal-test", "GDK_BACKEND": "wayland"})
                    compositor = subprocess.Popen(["weston", "--backend=headless-backend.so", "--socket=agent-terminal-test", "--idle-time=0"], env=env, stdout=log, stderr=log, start_new_session=True)
                    for _ in range(100):
                        if (root / "runtime/agent-terminal-test").exists():
                            break
                        if compositor.poll() is not None:
                            raise RuntimeError("Wayland compositor failed to start")
                        time.sleep(0.1)
                    else:
                        raise RuntimeError("Wayland compositor startup timed out")
                else:
                    env["GDK_BACKEND"] = "x11"
                    command = ["xvfb-run", "-a", "dbus-run-session", "--", sys.executable, "-E", str(Path(__file__).resolve()), "--x11-lifecycle", str(app)]
                process = subprocess.Popen(command, env=env, stdout=log, stderr=log, start_new_session=True)
                if backend == "x11":
                    if process.wait(timeout=150) != 0:
                        raise RuntimeError("X11 lifecycle smoke test failed")
                    print("PASS packaged app X11 lifecycle")
                    return
                try:
                    code = process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    print(f"PASS {'AppImage' if image else 'native package'} remained running under {backend}")
                else:
                    raise RuntimeError(f"AppImage exited during startup: {code}")
            except Exception:
                log.flush()
                print((root / "startup.log").read_text(errors="replace"))
                raise
            finally:
                stop(process)
                stop(compositor)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--image", type=Path)
    target.add_argument("--binary", type=Path)
    target.add_argument("--x11-lifecycle", type=Path)
    parser.add_argument("--backend", choices=["x11", "wayland"])
    args = parser.parse_args()
    if args.x11_lifecycle:
        x11_lifecycle(args.x11_lifecycle)
    elif args.backend:
        smoke(args.image.resolve() if args.image else None, args.binary, args.backend)
    else:
        parser.error("--backend is required for package smoke tests")
