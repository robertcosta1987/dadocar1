"""Quick local smoke test: posts a sample text + audio-shaped webhook to the bot.
Run the server first (uvicorn main:app --port 8000). Audio test needs real WaSender
media to fully work; here we just confirm routing + signature handling."""
import os, httpx
BASE = os.getenv("BOT_URL", "http://localhost:8000")
SECRET = os.getenv("WASENDER_WEBHOOK_SECRET", "")
h = {"X-Webhook-Signature": SECRET, "Content-Type": "application/json"}
text_event = {"event": "messages.received", "data": {"messages": {
    "key": {"id": "TEST1", "remoteJid": "5511999999999@s.whatsapp.net", "fromMe": False},
    "message": {"conversation": "Oi Lisa, como funciona a consulta?"}}}}
print("health:", httpx.get(f"{BASE}/health").json())
print("text webhook:", httpx.post(f"{BASE}/webhook", headers=h, json=text_event).status_code)
