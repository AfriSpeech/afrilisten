"""
Modal deployment for the AfriSpeech Listen token service.

This runs the exact Node service `npm start` runs locally: `server.mjs`
adapting the fetch handler in `src/index.mjs` to Node's http server. Nothing
here is Modal-specific about the service itself; Modal just holds the
container's port open and proxies requests to it.

The service itself is now very small on purpose: it mints short-lived Gemini
Live tokens (src/lib/tokens.mjs) and nothing else. The actual translation and
speech happen in a Gemini Live session the browser opens for itself, directly,
using one of those tokens -- the page's text never reaches this container at
all. What still needs a server is minting the token, since that is the one
step that needs the real, long-lived GEMINI_API_KEY.

Deploy:  modal deploy modal_app.py
Logs:    modal app logs afrispeech-listen
"""
import os
import subprocess

import modal

app = modal.App("afrispeech-listen")

PORT = 8787

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
    timeout=1800,
    min_containers=0,
    # Minting a token is one small JSON round trip to Google, not compute
    # work, so this asks for Modal's floor rather than its default-if-unset
    # (which happens to be the same number, but stated explicitly here so it
    # stays true on purpose rather than by accident of what Modal defaults to).
    cpu=0.125,
    memory=128,
    # How long an idle container is kept warm before scaling back to zero --
    # and so how long a burst of traffic is billed for after it actually
    # stops, since min_containers=0 means nothing runs, and nothing is
    # billed, outside of that window. Short on purpose: a cold start here is
    # a Node process starting, not a container image being pulled fresh, so
    # the latency cost of scaling to zero quickly is small.
    scaledown_window=60,
)
@modal.concurrent(max_inputs=32)
@modal.web_server(PORT, startup_timeout=60)
def serve():
    subprocess.Popen(
        ["node", "server.mjs"],
        cwd="/app",
        env={**os.environ, "PORT": str(PORT), "HOST": "0.0.0.0"},
    )
