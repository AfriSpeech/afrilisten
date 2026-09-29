"""
Modal deployment for the AfriSpeech Listen token service.

This runs the exact Node service `npm start` runs locally: `server.mjs`
adapting the fetch handler in `src/index.mjs` to Node's http server. Nothing
here is Modal-specific about the service itself; Modal just holds the
container's port open and proxies requests to it.

The service itself is now very small on purpose: it mints short-lived Gemini
Live tokens (src/lib/tokens.mjs) and records per-language feedback
(src/lib/feedback.mjs), nothing else. The actual translation and speech
happen in a Gemini Live session the browser opens for itself, directly, using
one of those tokens -- the page's text never reaches this container at all.
What still needs a server is minting the token, since that is the one step
that needs the real, long-lived GEMINI_API_KEY, and holding feedback
somewhere that outlives one container.

Feedback is one small file per rating on a Modal Volume, not one shared,
appended-to file: Volumes commit in the background and use last-write-wins on
a shared file, so two ratings written around the same moment from different
containers could silently drop one. Two different files never conflict. See
src/lib/feedback.mjs for the full reasoning.

Deploy:  modal deploy modal_app.py
Logs:    modal app logs afrispeech-listen
"""
import os
import subprocess

import modal

app = modal.App("afrispeech-listen")

PORT = 8787
FEEDBACK_DIR = "/data/feedback"

# create_if_missing so the very first deploy doesn't need a separate manual
# step; the volume then persists across every redeploy after that.
feedback_volume = modal.Volume.from_name("afrispeech-listen-feedback", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "ca-certificates", "gnupg")
    # Debian's own nodejs package is far behind; @google/genai needs Node >=20.
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
    )
    .workdir("/app")
    # Copied and installed before the rest of the source, so this layer is
    # cached and only rebuilds when the dependencies actually change.
    .add_local_file("package.json", "/app/package.json", copy=True)
    .add_local_file("package-lock.json", "/app/package-lock.json", copy=True)
    .run_commands("cd /app && npm ci --omit=dev")
    .add_local_dir(
        ".",
        "/app",
        copy=True,
        ignore=[
            "node_modules", ".git", "test", ".env", ".env.example",
            "*.md", "modal_app.py",
            # The widget and its Readability dependency: served to embedders
            # from this repo via jsDelivr, not by this server, which has no
            # route for static files at all.
            "public",
        ],
    )
)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("afrispeech-listen-secrets")],
    # This deployment is now the zero-config default every embedder's widget
    # talks to unless they set up their own, so the shared daily budget below
    # is the one number standing between that and unbounded Gemini spend.
    # LISTEN_SHARED_DEFAULT flips the usage notice's wording to say so.
    env={"LISTEN_BUDGET_PER_DAY": "10000", "LISTEN_SHARED_DEFAULT": "1"},
    volumes={"/data": feedback_volume},
    timeout=1800,
    # One container kept running at all times, so a reader never pays for a
    # cold start. Affordable specifically because of how little this asks
    # for below: at Modal's published rate (2026), 0.125 core + 256 MiB
    # continuously is about $0.0000023/sec, which works out to roughly
    # $6/month for one container that is never actually idle-to-zero. Raise
    # this only if traffic needs more than one warm container at once; extra
    # containers beyond this floor still scale down via scaledown_window.
    min_containers=1,
    # Minting a token is one small JSON round trip to Google, not CPU work,
    # so 0.125 core (Modal's floor) is plenty. Memory is a little above the
    # floor (128 -> 256 MiB) for headroom under the higher per-container
    # concurrency below, which is otherwise the same idle cost either way.
    cpu=0.125,
    memory=256,
    # How long an extra container (beyond the one min_containers keeps warm)
    # stays up after a burst of traffic before scaling back down.
    scaledown_window=60,
)
# High on purpose: the rate limiter and the shared daily budget are in-memory
# per container (see src/lib/ratelimit.mjs), not a distributed counter, so
# they are only accurate as long as one container is handling everything.
# Minting a token is I/O-bound -- waiting on Google, not CPU -- so one
# container can hold far more of these in flight at once than the CPU
# allocation above would suggest, and raising this is what keeps traffic on
# that one accurate counter rather than spreading it across several
# containers that would each enforce the limits independently.
@modal.concurrent(max_inputs=100)
@modal.web_server(PORT, startup_timeout=60)
def serve():
    subprocess.Popen(
        ["node", "server.mjs"],
        cwd="/app",
        env={**os.environ, "PORT": str(PORT), "HOST": "0.0.0.0", "LISTEN_FEEDBACK_DIR": FEEDBACK_DIR},
    )
