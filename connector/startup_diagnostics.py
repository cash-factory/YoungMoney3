"""Pre-runtime-hook diagnostics, enabled only by the CI startup argument."""
import sys

if len(sys.argv) == 3 and sys.argv[1] == "--startup-smoke":
    # Windowed bootloaders otherwise have no stderr, including when a built-in
    # runtime hook or an imported native dependency fails before main().
    sys.stderr = open(sys.argv[2] + ".log", "w", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr
    print("Frozen startup diagnostics enabled", flush=True)
