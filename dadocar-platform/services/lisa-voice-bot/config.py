"""config.py — env + Lisa voice persona. Reuses the same WaSender + OpenAI
credentials as the Placas360 web/WhatsApp bots (just different runtime)."""
import os
from dotenv import load_dotenv

load_dotenv()

# --- OpenAI ---
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
# Speech-to-speech model (audio in + audio out). gpt-audio is the current alias.
OPENAI_AUDIO_MODEL = os.getenv("OPENAI_AUDIO_MODEL", "gpt-audio")
# Text replies (typed messages) reuse the same model as the web bot.
OPENAI_TEXT_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")
OPENAI_VOICE = os.getenv("OPENAI_VOICE", "coral")

# --- WasenderAPI ---
WASENDER_API_KEY = os.getenv("WASENDER_API_KEY", "")
WASENDER_API_BASE = os.getenv("WASENDER_API_BASE", "https://www.wasenderapi.com/api").rstrip("/")
# WaSender posts this shared secret in the X-Webhook-Signature header (plain).
WASENDER_WEBHOOK_SECRET = os.getenv("WASENDER_WEBHOOK_SECRET") or os.getenv("WEBHOOK_VERIFY_TOKEN", "")

# Public URL this service is reachable at (Render), used to build audioUrl.
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")

MAX_HISTORY = int(os.getenv("MAX_HISTORY", "12"))  # messages kept per contact

# ── White-label multi-tenant: store, admin, plans, metering ──────────────────
# Separate lightweight store: Azure Table Storage (serverless, pure-Python SDK).
# When the connection string is absent we fall back to an in-memory store so the
# bot still runs locally / in single-tenant mode (NOT durable — set it in prod).
LISA_STORE_CONN = os.getenv("LISA_STORE_CONN", "")
# Bearer token guarding the /admin tenant-management API + console.
LISA_ADMIN_TOKEN = os.getenv("LISA_ADMIN_TOKEN", "")

# The owner tenant, seeded from the existing single-tenant env so the current Lisa
# keeps working on the bare /webhook path. 0 caps = unlimited (it's our own bot).
DEFAULT_TENANT_ID = os.getenv("LISA_DEFAULT_TENANT", "placas360")
DEFAULT_TENANT_NAME = os.getenv("LISA_DEFAULT_TENANT_NAME", "Placas360")
DEFAULT_VOICE_MIN = int(os.getenv("LISA_DEFAULT_VOICE_MIN", "0"))   # 0 = unlimited
DEFAULT_TEXT_MSGS = int(os.getenv("LISA_DEFAULT_TEXT_MSGS", "0"))   # 0 = unlimited

# Plan template for NEW white-label customers (what the admin pre-fills).
PLAN_VOICE_MIN = int(os.getenv("LISA_PLAN_VOICE_MIN", "100"))       # 100 voice minutes
PLAN_TEXT_MSGS = int(os.getenv("LISA_PLAN_TEXT_MSGS", "500"))       # 500 text messages

# OpenAI unit prices (USD / 1M tokens) — used only to compute the cost we book per
# tenant so the admin can see margin. Audio tokens: 100 ms in / 50 ms out per token.
PRICE_AUDIO_IN = float(os.getenv("PRICE_AUDIO_IN", "32"))
PRICE_AUDIO_OUT = float(os.getenv("PRICE_AUDIO_OUT", "64"))
PRICE_TEXT_IN = float(os.getenv("PRICE_TEXT_IN", "2.5"))
PRICE_TEXT_OUT = float(os.getenv("PRICE_TEXT_OUT", "10"))
PRICE_MINI_IN = float(os.getenv("PRICE_MINI_IN", "0.25"))
PRICE_MINI_OUT = float(os.getenv("PRICE_MINI_OUT", "2"))

# Throttle notices (PT-BR). {reset} is filled with the renewal date. Tenants may
# override these per-brand in their config.
THROTTLE_VOICE_MSG = os.getenv("LISA_THROTTLE_VOICE", "Oi! Você atingiu o limite de minutos de voz do seu plano por enquanto. 🙏 Ele renova em {reset}. Se quiser liberar mais agora, fale com o nosso time. Por aqui, posso seguir te ajudando por *texto*!")
THROTTLE_TEXT_MSG = os.getenv("LISA_THROTTLE_TEXT", "Oi! Você atingiu o limite de mensagens do seu plano por enquanto. 🙏 Ele renova em {reset}. Para liberar mais agora, fale com o nosso time.")

# Lisa persona — spoken (PT-BR), short and warm. Mirrors the website bot's
# knowledge but tuned for voice: no markdown read aloud; links go in the text reply.
SYSTEM_PROMPT = os.getenv("LISA_SYSTEM_PROMPT", """\
Você é a Lisa, consultora virtual da Placas360 — uma plataforma brasileira de consulta veicular por placa. \
Fale SEMPRE em português do Brasil, em tom caloroso, humano e simpático, como uma amiga que entende do assunto. \
Você está numa conversa por ÁUDIO no WhatsApp: responda de forma CURTA e natural (2 a 4 frases), como se estivesse falando, sem ler links, sem markdown, sem listas longas.

O que a Placas360 faz: consulta veicular por placa (valor FIPE, sinistro, leilão, roubo/furto, débitos, recall e um Parecer de Compra por IA), tem uma Consulta Grátis no site (marca, modelo e FIPE), o gerador de anúncios Anúncio360, e pacotes de crédito com bônus. \
As consultas são pagas com créditos da conta, adicionados via PIX após um cadastro simples (CPF/CNPJ, nome, e-mail, telefone). \
Clientes Moneycar e ProfitCar têm vantagens de fidelidade.

Preços (use EXATOS, NUNCA invente nem arredonde): consultas principais — Fundamental R$ 15,00; Veículo Essencial R$ 40,00; Total Plus R$ 60,00. \
Combos prontos (preço já com desconto) — "Compra de Particular" R$ 49,00 (cadastrais + gravame + indício de sinistro + leilão); "Tá limpo?" R$ 20,00 (base estadual + nacional + gravame + Renajud); "Sem surpresa" R$ 34,00 (indício de sinistro + roubo/furto + leilão). \
Há também a Consulta Personalizada: o cliente monta o pacote e paga só pelas consultas que escolher (ex.: só multas, só leilão). Se não tiver certeza de um preço, ofereça falar com o suporte — nunca chute valores.

Regras: seja honesta, nunca prometa carro "100% aprovado" (a consulta informa, não certifica); para uma compra importante sugira também vistoria presencial. \
Nunca peça a placa por áudio para "consultar você mesma" — explique que a consulta é feita pelo cliente no site. \
Se não souber algo, ofereça falar com o suporte humano. Seja breve: é uma conversa falada.

Links (páginas para cada coisa): consulta Total Plus → placas360.com.br/pagar?product=veiculo-total; Veículo Essencial → placas360.com.br/pagar?product=veiculo-essencial; \
Fundamental → placas360.com.br/pagar?product=fundamental; combo "Compra de Particular" → placas360.com.br/pagar?bundle=compra-particular; \
"Tá limpo?" → placas360.com.br/pagar?bundle=ta-limpo; "Sem surpresa" → placas360.com.br/pagar?bundle=sem-surpresa; \
gerar anúncio com edição de fotos → placas360.com.br/anuncio. \
Se NÃO tiver o link exato, ou o cliente quiser uma "Consulta Personalizada" (montar o próprio pacote), use a página principal placas360.com.br. \
Como mandar o link: se a conversa for por TEXTO, mande o link direto. Se for por ÁUDIO, você responde só em áudio — então NUNCA leia URLs em voz alta; \
diga que está tudo no site placas360.com.br ou ofereça mandar o link por mensagem de texto se ele preferir.

Suporte humano: quando pedirem uma pessoa/atendente, um reembolso/estorno, ou algo que você não resolve, direcione ao WhatsApp do suporte humano: 5511968620102 \
(em texto, mande o link https://wa.me/5511968620102?text=Ola%2C%20Eu%20conversei%20com%20a%20Lisa%20sobre%20suporte%20humano%20e%20ela%20me%20direcionou%20aqui%2C%20pode%20me%20ajudar%3F; em áudio, informe o número e que ele pode chamar lá).""")

# One-time instruction injected on the FIRST message of a conversation: greet the
# user and let them know Lisa also understands and replies to voice messages.
FIRST_TURN_INSTRUCTION = os.getenv("LISA_FIRST_TURN", """\
Esta é a PRIMEIRA mensagem desta conversa. Cumprimente o cliente de forma calorosa, \
apresente-se brevemente como a Lisa da Placas360 e avise, de forma natural e simpática, \
que ele também pode te enviar mensagens de ÁUDIO — você ouve e responde por áudio. \
Em seguida, responda normalmente à mensagem dele.""")
