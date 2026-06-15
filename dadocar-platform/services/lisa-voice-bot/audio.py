"""audio.py — ffmpeg transcode helpers. WhatsApp voice notes arrive as OGG/OPUS,
but OpenAI's audio input accepts only wav/mp3, so we transcode to mp3. ffmpeg must
be installed (the Dockerfile installs it)."""
import logging
import subprocess

log = logging.getLogger("lisa.audio")


def to_mp3(src_bytes: bytes) -> bytes:
    """Transcode arbitrary input audio (e.g. OGG/OPUS) to mp3 via ffmpeg (stdin→stdout)."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
         "-vn", "-ac", "1", "-ar", "16000", "-f", "mp3", "pipe:1"],
        input=src_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"ffmpeg transcode failed: {proc.stderr.decode('utf-8', 'ignore')[:300]}")
    log.info("transcoded %d bytes → %d bytes mp3", len(src_bytes), len(proc.stdout))
    return proc.stdout
