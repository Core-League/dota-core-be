import asyncio
import json
import os
import re
import ssl
from datetime import datetime
from html import escape as html_escape
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart, CommandObject
from aiogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
)

from dotenv import load_dotenv

# =========================
# CONFIG
# =========================

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
# Якщо MODEL у .env не задано — приклад платної недорогої моделі; для :free змінні дивись MODEL_FALLBACKS.
MODEL = os.getenv("MODEL") or "openai/gpt-4o-mini"
# Через кому: резервні моделі, якщо OpenRouter відповідає «No endpoints found» (маршрутизація змінюється).
MODEL_FALLBACKS_RAW = os.getenv(
    "MODEL_FALLBACKS",
    "meta-llama/llama-3.3-70b-instruct:free,openai/gpt-4o-mini",
)
# POST base without trailing slash, e.g. https://openrouter.ai/api/v1
OPENROUTER_API_BASE = os.getenv("OPENROUTER_API_BASE", "https://openrouter.ai/api/v1").rstrip("/")
# При 429 (ліміт провайдера / черга) повторити запит із паузою
try:
    OPENROUTER_429_RETRIES = max(1, int(os.getenv("OPENROUTER_429_RETRIES", "4")))
except ValueError:
    OPENROUTER_429_RETRIES = 4
try:
    OPENROUTER_429_BACKOFF = float(os.getenv("OPENROUTER_429_BACKOFF", "3"))
except ValueError:
    OPENROUTER_429_BACKOFF = 3.0

TICKETS_FILE = "tickets.json"

# ============================================================
# Теги виконавців за областю (#Область у тексті тікета; ставить бот автоматично)
# ============================================================
# Нікнейми — **точний регістр**, як давали замовники (Telegram узгоджує по casefold).
# Єгор @tsuyotorankiraizaa; Ігор @I_g_o_r_y_a_n_i_c_h; Іван @jovanni_77;
# монтаж @ArmeyskyiDjigid; копірайт @blood1eye; дизайн @kodokushiiiii;
# засновники @StanislavPopikk, @olezi0, @Savito.
# ІТ @olezi0, @I_Skorychenko, @olleyo (olezi0 дублюється з FOUNDERS — один канон у словнику).
_TEAM_HANDLES_MEDIA = ("I_g_o_r_y_a_n_i_c_h", "jovanni_77")
_TEAM_HANDLES_MONTAGE = ("ArmeyskyiDjigid",)
_TEAM_HANDLES_COPY = ("blood1eye",)
_TEAM_HANDLES_DESIGN = ("kodokushiiiii",)
_TEAM_HANDLES_ADMIN = ("tsuyotorankiraizaa",)
_TEAM_HANDLES_IT = ("olezi0", "I_Skorychenko", "olleyo")
_TEAM_HANDLES_FOUNDERS = ("StanislavPopikk", "olezi0", "Savito")

_TEAM_USERNAME_CANON: dict[str, str] = {}
for _group in (
    _TEAM_HANDLES_MEDIA,
    _TEAM_HANDLES_MONTAGE,
    _TEAM_HANDLES_COPY,
    _TEAM_HANDLES_DESIGN,
    _TEAM_HANDLES_ADMIN,
    _TEAM_HANDLES_IT,
    _TEAM_HANDLES_FOUNDERS,
):
    for _h in _group:
        _key = _h.casefold()
        if _key in _TEAM_USERNAME_CANON and _TEAM_USERNAME_CANON[_key] != _h:
            raise RuntimeError(
                f"Неузгоджений регістр нікнейма команди: {_TEAM_USERNAME_CANON[_key]!r} vs {_h!r}"
            )
        _TEAM_USERNAME_CANON[_key] = _h

_AREA_TAG_MEDIA = _TEAM_HANDLES_MEDIA
_AREA_TAG_MONTAGE = _TEAM_HANDLES_MONTAGE
_AREA_TAG_COPY = _TEAM_HANDLES_COPY
_AREA_TAG_DESIGN = _TEAM_HANDLES_DESIGN
_AREA_TAG_ADMIN = _TEAM_HANDLES_ADMIN
_AREA_TAG_IT = _TEAM_HANDLES_IT
_AREA_TAG_FOUNDERS = _TEAM_HANDLES_FOUNDERS


def _team_username_canonical(for_display: str) -> str:
    """Жорсткий канонічний регістр для відомих нікнеймів; інакше — рядок як є без зміни кейсу."""
    s = str(for_display).strip().lstrip("@")
    return _TEAM_USERNAME_CANON.get(s.casefold(), s)


_PREASSIGN_ALIASES: dict[str, str] = {}

def _preassign_alias(alias: str, handle_canon: str) -> None:
    key = alias.casefold().strip()
    canon = _team_username_canonical(handle_canon.strip().lstrip("@"))
    if key in _PREASSIGN_ALIASES and _PREASSIGN_ALIASES[key] != canon:
        raise RuntimeError(f"Подвійний аліас призначення «{alias}»: {_PREASSIGN_ALIASES[key]!r} vs {canon!r}")
    _PREASSIGN_ALIASES[key] = canon


def _bind_preset_assign_aliases() -> None:
    """Імʼя / нік із «Тікет для …» → канонічний Telegram username без @."""
    _PREASSIGN_ALIASES.clear()
    _PREASSIGN_ALIASES.update(_TEAM_USERNAME_CANON)

    aliases_by_handle: tuple[tuple[str, tuple[str, ...]], ...] = (
        (
            "I_g_o_r_y_a_n_i_c_h",
            ("ігор", "igor", "ігора", "ігорю", "ігореві"),
        ),
        ("jovanni_77", ("іван", "ivan", "івана", "івану", "іванові")),
        ("ArmeyskyiDjigid", ("тіма", "тима", "tima", "тіми", "тімі", "тіму")),
        ("blood1eye", ("бетон", "beton", "бетона", "бетону")),
        ("kodokushiiiii", ("саша", "sasha", "sascha", "саші", "сашу")),
        ("tsuyotorankiraizaa", ("єгор", "егор", "yehor", "єгора", "єгору", "єгорові")),
        (
            "StanislavPopikk",
            (
                "станіслав",
                "станислав",
                "стас",
                "stanislav",
                "popik",
                "станіслава",
                "станіславу",
            ),
        ),
        (
            "Savito",
            (
                "женя",
                "євген",
                "evgen",
                "zhenya",
                "женю",
                "жені",
                "євгена",
                "євгену",
                "євгенові",
            ),
        ),
        (
            "olezi0",
            (
                "olezi",
                "дядя олег",
                "дядья олег",
                "оля дядя",
                "дядю олега",
                "дядя олега",
            ),
        ),
        ("olleyo", ("olley", "olleo", "олег", "oleg", "олега", "олегу", "олегові")),
        (
            "I_Skorychenko",
            ("ілля", "илля", "illia", "illya", "іллю", "іллі"),
        ),
    )
    for handle, aliases in aliases_by_handle:
        for al in aliases:
            _preassign_alias(al, handle)

_bind_preset_assign_aliases()

_PRE_ASSIGN_HEADER_RX = re.compile(r"(?is)^\s*(?:тікет|ticket)\s+(?:до|для|for)\s+")


def split_preset_assignee_prefix(raw: str) -> tuple[str, str | None]:
    """
    Повертає (текст для генерації тікета, імʼя виконавця з префікса або None).
    Приклади: «Тікет для Ілля\\n\\nОпис», «ticket for @x — текст», «Тікет для Олег: …».
    """
    s = raw.strip()
    m = _PRE_ASSIGN_HEADER_RX.match(s)
    if not m:
        return s, None
    rest = s[m.end() :].lstrip()
    if not rest.strip():
        return s, None

    # Переніс після імені: один або два порожні рядки між «хто» і «що»
    mn = re.match(r"(?s)^(?P<who>.+?)\n\s*\n\s*(?P<body>\S[\s\S]*)$", rest)
    if mn:
        who, body = mn.group("who").strip(), mn.group("body").strip()
        return (body if body else rest, who)

    mn1 = re.match(r"(?s)^(?P<who>.+?)\s*\n(?P<body>\S[\s\S]*)$", rest)
    if mn1:
        who, body = mn1.group("who").strip(), mn1.group("body").strip()
        return body, who

    # Одна строка: @username —
    mr = re.match(
        r"(?is)^(?P<u>@[a-z][a-z0-9_]{3,})\s*(?:[\u2014\u2013\-:]{1,3}\s*|:)\s*(?P<b>\S.+)$",
        rest,
    )
    if mr:
        return mr.group("b").strip(), mr.group("u").strip()

    mr2 = re.match(
        r"(?is)^(?P<u>@[a-z][a-z0-9_]{3,})\s+(?P<b>\S.+)$",
        rest,
    )
    if mr2:
        return mr2.group("b").strip(), mr2.group("u").strip()

    mc = re.match(
        r"(?is)^(?P<who>[^\n:]{1,120}?)\s*:\s*(?P<b>\S[\s\S]+)$",
        rest,
    )
    if mc:
        return mc.group("b").strip(), mc.group("who").strip()

    md = re.match(
        r"(?is)^(?P<who>[^\n\u2014\u2013\-]{2,120}?)\s+[\u2014\u2013\-]\s+(?P<b>\S[\s\S]+)$",
        rest,
    )
    if md:
        return md.group("b").strip(), md.group("who").strip()

    tw = rest.split(None, 1)
    if len(tw) == 2 and tw[1].strip():
        return tw[1].strip(), tw[0].strip()

    return s, None


def resolve_preset_assignee(who_fragment: str) -> tuple[str | None, str]:
    """
    Повертає (канонічний telegram username без префіксу @ або None, нормалізований фрагмент для відображення).
    """
    raw = who_fragment.strip().strip(" ,.;\u00ab\u00bb\"").strip()
    raw = raw.rstrip("\u2026.,;:!?")
    if not raw:
        return None, ""

    at_m = re.fullmatch(r"@([A-Za-z][A-Za-z0-9_]{3,})", raw)
    if at_m:
        return at_m.group(1), raw
    nf = raw.casefold()
    if nf in _PREASSIGN_ALIASES:
        return _PREASSIGN_ALIASES[nf], raw

    for prefix_handle in (
        ("дядя олег", "olezi0"),
        ("дядья олег", "olezi0"),
        ("дядя олегі", "olezi0"),
    ):
        pref, hid = prefix_handle
        if nf.startswith(pref.casefold()):
            return _team_username_canonical(hid), raw

    return None, raw


def preset_assign_footer_line(canonical_username: str | None, raw_fragment: str, linked_telegram: bool) -> str:
    """Один HTML-безпечний рядок без зовнішніх жирних обгорток (ticket_message_html додає)."""
    if canonical_username:
        nick = html_escape(_team_username_canonical(canonical_username), quote=False)
        if linked_telegram:
            return f"Виконавець: @{nick}"
        return f"Призначено: @{nick}"
    if raw_fragment.strip():
        return "Призначено: " + html_escape(raw_fragment.strip(), quote=False)
    return ""


async def telegram_user_id_by_username(bot: Bot, username: str) -> int | None:
    """Спробує отримати user id за публічним @username."""
    hn = username.strip().lstrip("@")
    if not hn or len(hn) < 5 or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{4,31}", hn):
        return None
    try:
        chat = await bot.get_chat(f"@{hn}")
        tid = getattr(chat, "id", None)
        if tid is None:
            return None
        return int(tid)
    except Exception:
        return None


def _uniq_usernames(usernames: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for u in usernames:
        c = _team_username_canonical(u)
        key = c.casefold()
        if key not in seen:
            seen.add(key)
            out.append(c)
    return out


def _area_slug_fold(slug: str) -> str:
    """Нормалізація лише slug #Області; самі нікнейми лише через _team_username_canonical."""
    return slug.strip().lstrip("#").casefold()


def extract_ticket_area_hashtag(formatted: str) -> str:
    """Повертає slug після # у блоці «Область» або порожній рядок."""
    lines = formatted.replace("\r\n", "\n").split("\n")
    for i, ln in enumerate(lines):
        if "🏷" in ln and "Область" in ln:
            for j in range(i + 1, min(i + 15, len(lines))):
                t = lines[j].strip()
                if not t:
                    continue
                if t.startswith("#"):
                    return t[1:].strip()
            return ""
    return ""


def usernames_for_ticket_area(slug: str) -> list[str]:
    """
    Підбір @-нікнеймів за #Область.
    Адміністратори → адмін + засновники; ІТ за префіксом/ключовими словами → трійка ІТ; невідомо / порожньо → лише засновники.
    """
    h = _area_slug_fold(slug)
    if not h:
        return list(_AREA_TAG_FOUNDERS)

    def has(*needles: str) -> bool:
        return any(n in h for n in needles)

    # Таска для адміна — тегаємо адміна та засновників
    if has("адмін", "admin", "модератор", "moderator"):
        return _uniq_usernames(list(_AREA_TAG_ADMIN) + list(_AREA_TAG_FOUNDERS))

    # Явно лише засновники (окрема область)
    if has("заснов", "founder", "керівництво"):
        return list(_AREA_TAG_FOUNDERS)

    # ІТ: префікс тегу #IT / #ІТ або явні тех.-ключові слова (не «іт» усередині слів — Twitch, rabbit тощо)
    if (
        h.startswith("it")
        or h.startswith("іт")
        or has(
            "розроб",
            "програмуван",
            "бекенд",
            "frontend",
            "фронтенд",
            "fullstack",
            "інфраструкт",
            "сервер",
            "депло",
            "deploy",
            "репозит",
            "github",
            "gitlab",
            "devops",
            "девопс",
            "сайту",
            "вебчастин",
            "dotaMatch".casefold(),
        )
    ):
        return list(_AREA_TAG_IT)

    if has("монтаж", "montage", "premiere", "таймлапс"):
        return list(_AREA_TAG_MONTAGE)
    if has("копірайт", "копір", "copywriter", "copywrit", "текст", "оголошен"):
        return list(_AREA_TAG_COPY)
    if has("дизайн", "design", "макет", "баннер", "банер", "cover", "обкладин"):
        return list(_AREA_TAG_DESIGN)
    if has(
        "медіа",
        "media",
        "tiktok",
        "youtube",
        "instagram",
        "insta",
        "стрім",
        "стріми",
        "smm",
        "соцмереж",
        "анонс",
        "рилс",
        "reels",
    ):
        return list(_AREA_TAG_MEDIA)

    return list(_AREA_TAG_FOUNDERS)


def html_telegram_username_mentions(usernames: list[str]) -> str:
    """
    Рядок @нікнеймів для ParseMode.HTML **без** посилань на t.me / tg://:
    інакше Telegram часто показує «You can contact … right away» лише для одного з кількох профілів.
    """
    parts: list[str] = []
    for u in usernames:
        name = _team_username_canonical(u)
        if not name:
            continue
        parts.append("@" + html_escape(name, quote=False))
    return " ".join(parts)


def ticket_record_mentions_override(t: dict | None) -> list[str] | None:
    """
    Немає ключа mentions_override → тегуємо всю підбірку ролі за #Область.
    Ключ із порожнім списком → блок із @ не показуємо.
    Інакше → лише вказані нікнейми.
    """
    if not t or "mentions_override" not in t:
        return None
    mo = t["mentions_override"]
    if isinstance(mo, list):
        return mo
    return None


def ticket_team_mentions_html_suffix(
    formatted_plain: str,
    *,
    mentions_override: list[str] | None = None,
) -> str:
    raw = (formatted_plain or "").strip()
    if not raw or raw.startswith("❌"):
        return ""

    if mentions_override is not None:
        users = _uniq_usernames(list(mentions_override))
        if not users:
            return ""
        block_title = "Призначена особа" if len(users) == 1 else "Призначені особи"
        line = html_telegram_username_mentions(users)
        return (
            "\n\n<b>"
            + html_escape(block_title, quote=False)
            + "</b>\n"
            + line
        )

    slug = extract_ticket_area_hashtag(formatted_plain)
    users_r = usernames_for_ticket_area(slug)
    if not users_r:
        return ""
    line_r = html_telegram_username_mentions(users_r)
    return (
        "\n\n<b>"
        + html_escape("👥 Пропоновані виконавці", quote=False)
        + "</b>\n"
        + line_r
    )


SYSTEM_PROMPT = """
Ти готуєш **внутрішні робочі тікети** команди **Core League** українською.


**Тон відповіді:** стисло й по-службовому, але **не «сухі кістки»** — текст мають читати колегам без здогадок: достатній контекст у блоці «Опис» без води й без маркетингового пафосу (без порожніх закликів «підписуйся»).


— Контекст продукту (структуруй у голові, не копіпастити весь опис у відповідь) —
Проєкт: https://www.coreleague.online/ — турніри **Dota 2**, сітки **Double Elimination** (зазвичай **BO1**, ключові фінали **BO3**), матчі через `dotaMatchId`, є адмін-панель, Discord, канали TikTok тощо, спонсори Betking/Duelo.GG. Коротко узгоджуй `#Область` із цим, **не домислюй** факти, яких немає у вхідному запиті.


— Область і Telegram-теги (робить бот) —
- Одним рядком після секції Область — тільки службовий хештег **без пробілів**, за змістом задачі на кшталт `#Медіа`, `#TikTokАнонси`, `#Монтаж`, `#Копірайтер`, `#ІТ`, `#IT`, `#Адміністратори`, `#Дизайн`, `#Засновники` або комбінований CamelCase (**один** ключовий намір домінує в назві тегу).
- **Не пиши** `@username`, списків людей і блок із «пропонованими виконавцями» у тілі тікета — бот ставить підпис і @ сам: або **увесь основний набір особин за `#Область`**, або **лише призначена людина**, якщо у команді вказано «Тікет для імені / @ніка».



— Емодзі та секції —
- Починай **кожну** секцію з **одного конкретного емодзі** з нижнього списку, далі пробіл і **назва секції жирним** (як у шаблоні).
- Одна коротка «настрійова» **смужка емодзі** на початку тікета (одразу після заголовка «Задача», який додає бот): **не більш ніж шість** емодзі в один рядок; без довгої стіни спецсимволів і без тексту в тому ж рядку.


— Обовʼязково в «Описі задачі» —
- Після рядка `📝 **Опис задачі**` — **обовʼязково один порожній рядок**, далі першим ідуть булети (`•`).
- Якщо зміст запиту дозволяє — **мінімум 3 булети** (`•`): що зробити, **явний результат/артефакт**, дата/термін або «термін відсутній у запиті», платформа або канал, за потреби — аудиторія, обмеження, залежності **лише якщо вони випливають з тексту**.
- Якщо запит занадто короткий — максимум **2 булети**; без жодного додаткового абзацу після них.
- Без дублікатів; техніка (`dotaMatchId`, посилання) — лише з запиту.


— Суворе обмеження контенту (обовʼязково) —
- Кожен булет (`•`) має бути **прямо виведений з тексту запиту**. Не вигадуй кроки, платформи, матеріали, аудиторію, процедури — якщо цього немає у запиті, цього немає в тікеті.
- Якщо деталь явно очікується (дедлайн, платформа, рівень доступу), але відсутня в запиті — зазнач це прямо: `• Термін — не вказано в запиті`.
- Заборонені вирази-наповнювачі (не використовувати ніколи): «Важливо забезпечити…», «Необхідно забезпечити…», «Підготуйте всі необхідні…», «Забезпечити комфортний…» та будь-яке мотиваційне або моральне речення-підсумок, якого немає у запиті.


— Пріоритет (лише три слова, без Px) —
- **Не використовуй** коди типу **P1 / P2** — лише текстовий рівень одним із трьох слів: **Високий**, **Середній** або **Низький** (з великої літери, як заголовки рівнів у рядку).
- Формат під заголовком **одним рядком**: `**Низький** — короткий сухий рядок чому так` (суцільним рядком, без перенесення рівня на новий рядок без потреби).
- **Низький** — звичний фон, можна відкласти, нема очевидного блокера або дедлайн далеко.
- **Середній** — у штатній черзі задач доробок або медіапланів.
- **Високий** — вплив на дату/ефект турніру, жорсткіший термін або зрив створить проблему.
  Не плутати з «середнім»: якщо анонс привʼязаний до дати події або публікації й запізнення дорого → це або **Високий**.

— Інтервали між рядками (обовʼязково) —
У всьому тілі відповіді **не може бути двох і більше порожніх рядків поспіль** (максимум **одна** порожня лінія між абзацами).
Виняток: після заголовка `📝 **Опис задачі**` між ним і першим булетом **завжди рівно один** порожній рядок — не пропускай і не дублюй.
Після заголовків інших секцій (рядки з 🏷📌…) — перший смисловий рядок одразу **або через один порожній рядок**, не більше.
Між суміжним розділювачем `────────` та заголовком наступної секції — не більш **одного** порожнього рядка.

— Еталон компактності (орієнтир розмітки; не копіюй буквально «…», підстав контент з запиту) —
Не дублікай у відповідь жодних пояснювальних рядків у фігурних дужках — це лише секція промпту, її **немає** в твоєму тексті тікета; одразу з смужки емодзі (до 6 штук) або з переносу йде **лише** наступний шаблон:

📝 **Опис задачі**

• …
• …
• …

────────
🏷 **Область**
#CamelCaseБезПробілів

────────
📌 **Пріоритет**
**Середній** — коротке пояснювальне речення того ж блоку або одразу з нового рядка, але без подвійних порожніх рядків до/після.

Заборонено: **P1 / P2** та будь-які коди Px; службові рядки з еталону в `{…}` / копіпаст рядків пам'ятки з цього промпта; секції **⏱ Орієнтир по часу** та **🧠 Примітки** (їх взагалі немає в тікеті); секція **Складність** / ⚙️; два й більші порожні рядки поспіль між будь-якими місцями; окремий довідник Core League в тексті тікета; привітання / питання назад; *(службово: …)*; англ. Low/Medium у пріоритеті замість потрібних слів українською; «висячі» бектики з часом у відповіді; вигадані деталі (кроки, платформи, матеріали, процедури), яких немає в запиті; речення-наповнювачі «Важливо забезпечити…», «Необхідно забезпечити…», «Забезпечити комфортний…»; мотиваційний або моральний підсумковий абзац після булетів.
"""


# =========================
# BOT
# =========================

bot = Bot(
    token=BOT_TOKEN,
    default=DefaultBotProperties(parse_mode=ParseMode.HTML)
)

dp = Dispatcher()


def html_user_fragment(text: str) -> str:
    """Довільний текст (від LLM або імені) для вставки в ParseMode.HTML без поломки парсера."""
    return html_escape(str(text), quote=True)


def polish_ticket_plain_for_display(raw: str) -> str:
    """
    Якщо модель залишила лише рядок у `бектіках` з оцінкою часу (або «голі» N год) —
    перетворює на два читабельні рядки з курсивом і жирним.
    """
    lines = raw.split("\n")
    tick_only = re.compile(r"^\s*`([^`\n]+)`\s*$")
    time_like = re.compile(r"(год|дн|роб)", re.I)
    bare_h = re.compile(
        r"^\s*(?:[~≈]\s*)?(\d+(?:[\-/–]\d+)?)\s*(?:години\.?|год\.?)\s*$",
        re.I,
    )
    bare_d = re.compile(
        r"^\s*(?:[~≈]\s*)?(\d+(?:[\-/–]\d+)?)\s*(?:робоч(?:ий|их)\s*)?(?:день|днів|дн\.?)\s*$",
        re.I,
    )
    out: list[str] = []
    for ln in lines:
        m = tick_only.match(ln)
        if m:
            inner = m.group(1).strip().rstrip(".")
            if time_like.search(inner):
                out.append(
                    "*Що оцінюємо: основні кроки за задачею (деталі — у блоці «Опис»).*"
                )
                out.append(f"**Приблизно {inner}.**")
                continue
        if bare_h.match(ln) or bare_d.match(ln):
            inner = ln.strip().rstrip(".")
            out.append(
                "*Що оцінюємо: основні кроки за задачею (деталі — у блоці «Опис»).*"
            )
            out.append(f"**Приблизно {inner}.**")
            continue
        out.append(ln)
    return "\n".join(out)


def compact_vertical_whitespace(raw: str) -> str:
    """Усуває подвійні+ порожні рядки поспіль у тілі тікета перед HTML."""
    raw = raw.replace("\r\n", "\n")
    lines = [ln.rstrip() for ln in raw.split("\n")]
    out: list[str] = []
    prev_empty = False
    for ln in lines:
        if ln == "":
            if prev_empty:
                continue
            prev_empty = True
            out.append("")
        else:
            prev_empty = False
            out.append(ln)
    return "\n".join(out).strip()


def ensure_blank_after_description_heading(raw: str) -> str:
    """Між заголовком «Опис задачі» і першим смисловим рядком — рівно один порожній рядок."""
    marker = re.compile(r"^\s*📝\s*\*\*Опис задачі\*\*\s*$")
    lines = raw.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        if marker.match(line):
            k = i + 1
            while k < len(lines) and lines[k].strip() == "":
                k += 1
            if k < len(lines) and k == i + 1:
                out.append("")
        i += 1
    return "\n".join(out)


_TICKET_RULE_LINE = "────────"


def strip_deprecated_ticket_sections(raw: str) -> str:
    """Вирізає блоки Орієнтир по часу та Примітки (модель може їх порушити промпт)."""
    raw = raw.replace("\r\n", "\n")
    esc = re.escape(_TICKET_RULE_LINE)
    # Блок між ──── і наступним ──── або кінцем: заголовок ⏱ … Орієнт…
    pat_time = re.compile(
        rf"(?:^|\n){esc}\s*\n\s*⏱\s*\*\*[^\n]*Орієнт[^\n]*\*\*[\s\S]*?(?=(?:^|\n){esc}|\Z)",
        re.MULTILINE,
    )
    pat_notes = re.compile(
        rf"(?:^|\n){esc}\s*\n\s*🧠\s*\*\*[^\n]*Приміт[^\n]*\*\*[\s\S]*?(?=(?:^|\n){esc}|\Z)",
        re.MULTILINE,
    )
    s = pat_time.sub("", raw)
    s = pat_notes.sub("", s)
    s = re.sub(rf"(?:\n{esc}){{2,}}", rf"\n{esc}", s)
    return s


def strip_prompt_artifact_lines(raw: str) -> str:
    """Прибирає рядки-артефакти з еталону промпта (модель інколи копіює їх у тікет)."""
    raw = raw.replace("\r\n", "\n")
    # Рядки-нагадування з еталону на кшталт {до 6 емодзі …}
    pat = re.compile(
        r"(?m)^\s*\{[^\n]*(?:до\s*6\s*емодзі|пропускаєш\s*блок)[^\n]*\}\s*\n?",
        re.I,
    )
    s = pat.sub("", raw)
    return s.lstrip("\n")


_MD_SLOT_BASE = 0xE000
_MD_SLOT_MAX = 0xF8FF


def formatted_plain_to_telegram_html(text: str) -> str:
    """
    Піднабір Markdown з відповіді моделі → HTML для ParseMode.HTML.
    Підтримує: `код` / `` код ``, **жирний**, *курсив*, _курсив_.
    """
    s = polish_ticket_plain_for_display(str(text))
    s = compact_vertical_whitespace(s)
    s = strip_prompt_artifact_lines(s)
    s = strip_deprecated_ticket_sections(s)
    s = ensure_blank_after_description_heading(s)
    s = compact_vertical_whitespace(s)

    slots: list[str] = []
    slot_i = 0

    def push_slot(inner_html: str) -> str:
        nonlocal slot_i
        if slot_i > _MD_SLOT_MAX - _MD_SLOT_BASE:
            return inner_html
        ch = chr(_MD_SLOT_BASE + slot_i)
        slots.append(inner_html)
        slot_i += 1
        return ch

    def wrap_code(inner: str) -> str | None:
        """Порожній після strip — моно не створюємо, щоб не губити символ `."""
        t = inner.strip()
        if not t:
            return None
        return "<code>" + html_escape(t) + "</code>"

    # Спочатку ``подвійні апострофи`` — можна вкласти одинарний `
    def code_double(m: re.Match) -> str:
        w = wrap_code(m.group(1))
        return push_slot(w) if w is not None else m.group(0)

    s = re.sub(r"(?<![`])\`\`([\s\S]*?)\`\`(?![`])", code_double, s)

    # Потім одинарні `...` одним рядком (ігноруємо трипл-бектіки всьередині — рідко)
    def code_single(m: re.Match) -> str:
        w = wrap_code(m.group(1))
        return push_slot(w) if w is not None else m.group(0)

    s = re.sub(r"(?<![`])\`([^`\n]*?)\`(?!`)", code_single, s)
    s = re.sub(
        r"\*\*(.+?)\*\*",
        lambda m: push_slot("<b>" + html_escape(m.group(1)) + "</b>"),
        s,
        flags=re.DOTALL,
    )
    s = re.sub(
        r"(?<!\*)\*([^*\n]+)\*(?!\*)",
        lambda m: push_slot("<i>" + html_escape(m.group(1)) + "</i>"),
        s,
    )
    s = re.sub(
        r"_([^_\n]+)_",
        lambda m: push_slot("<i>" + html_escape(m.group(1)) + "</i>"),
        s,
    )

    s = html_escape(s)
    for i, fragment in enumerate(slots):
        s = s.replace(chr(_MD_SLOT_BASE + i), fragment, 1)
    return s

# =========================
# STORAGE
# =========================

def ensure_storage():
    if not os.path.exists(TICKETS_FILE):
        with open(TICKETS_FILE, "w", encoding="utf-8") as f:
            json.dump([], f)

def load_tickets():
    ensure_storage()
    with open(TICKETS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_tickets(data):
    with open(TICKETS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def generate_ticket_id():
    tickets = load_tickets()
    return 1 if not tickets else max(t["ticket_id"] for t in tickets) + 1

def create_ticket(ticket):
    data = load_tickets()
    data.append(ticket)
    save_tickets(data)

def update_ticket(ticket_id, updates):
    data = load_tickets()
    for t in data:
        if t["ticket_id"] == ticket_id:
            t.update(updates)
            break
    save_tickets(data)

def get_ticket(ticket_id):
    for t in load_tickets():
        if t["ticket_id"] == ticket_id:
            return t
    return None

# =========================
# OPENROUTER
# =========================

def _openrouter_error_message(data: dict) -> str:
    """Текст помилки з тіла OpenRouter (включаючи вкладені поля)."""
    err = data.get("error")
    parts: list[str] = []

    if isinstance(err, dict):
        if err.get("message"):
            parts.append(str(err["message"]))
        meta = err.get("metadata") or err.get("data")
        if isinstance(meta, dict):
            raw = meta.get("raw") or meta.get("provider_name") or meta.get("reason")
            if raw:
                s = str(raw)
                merged = " ".join(parts)
                if s not in merged:
                    parts.append(s)
    elif isinstance(err, str):
        parts.append(err)

    if data.get("message") and data["message"] not in parts:
        parts.append(str(data["message"]))
    if data.get("detail") and str(data["detail"]) not in " ".join(parts):
        parts.append(str(data["detail"]))

    return " — ".join(p for p in parts if p)


def _format_api_error(status: int, data: dict) -> str:
    """OpenRouter/OpenAI-shaped JSON errors → короткий текст у чат."""
    core = _openrouter_error_message(data)
    if core:
        line = f"❌ Помилка API {status}: {core}"
    else:
        line = f"❌ Помилка API {status}"

    if status == 429:
        line += (
            "\n\nОбмеження швидкості або черги на стороні провайдера / безкоштовного рівня OpenRouter. "
            "Спробуйте пізніше, іншу модель у MODEL або перевірте ліміти на openrouter.ai."
        )

    return line


def _models_to_try() -> list[str]:
    """Порядок: основна MODEL, потім MODEL_FALLBACKS (без дублікатів)."""
    primary = MODEL.strip()
    extra = [m.strip() for m in MODEL_FALLBACKS_RAW.split(",") if m.strip()]
    out: list[str] = []
    for m in [primary] + extra:
        if m and m not in out:
            out.append(m)
    return out


def _no_endpoints_response(status: int, data: dict) -> bool:
    """OpenRouter: модель існує в каталозі, але зараз немає жодного провайдера (:free тощо)."""
    if status != 404:
        return False
    err = data.get("error")
    msg = ""
    if isinstance(err, dict):
        msg = str(err.get("message", ""))
    elif isinstance(err, str):
        msg = err
    low = msg.lower()
    return "no endpoints found" in low or "no endpoints available" in low


def _urllib_safe_header_value(value: str) -> str:
    """urllib передає HTTP-заголовки через latin-1; кирилиця дає UnicodeEncodeError."""
    try:
        str(value).encode("latin-1")
        return str(value)
    except UnicodeEncodeError:
        # Немаповані символи → '?' для сумісності з http.client.
        return str(value).encode("latin-1", errors="replace").decode("latin-1")


def _sanitize_request_headers(headers: dict) -> dict[str, str]:
    return {str(k): _urllib_safe_header_value(v) for k, v in headers.items()}


def _openrouter_post_sync(url: str, payload: dict, headers: dict) -> tuple[int, dict]:
    """Sync HTTPS POST via stdlib (avoids aiohttp ssl= typing issues)."""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, headers=_sanitize_request_headers(headers), method="POST")
    ctx = ssl.create_default_context()
    try:
        with urlopen(req, timeout=60, context=ctx) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw)
    except HTTPError as e:
        raw = ""
        try:
            if e.fp:
                raw = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        try:
            parsed = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            parsed = {}
        return int(e.code), parsed


async def _chat_completions_attempt(
    url: str,
    payload: dict,
    headers: dict,
) -> tuple[int, dict]:
    """Один або кілька POST при тимчасовому 429 (паузи між спробами)."""
    backoff = OPENROUTER_429_BACKOFF
    last_status, last_data = 0, {}
    for attempt in range(OPENROUTER_429_RETRIES):
        status, data = await asyncio.to_thread(
            _openrouter_post_sync, url, payload, headers
        )
        last_status, last_data = status, data
        if status != 429:
            return status, data
        if attempt < OPENROUTER_429_RETRIES - 1:
            wait_s = backoff * (2**attempt)
            await asyncio.sleep(wait_s)
    return last_status, last_data


async def generate_ticket_text(text: str) -> str:
    if not OPENROUTER_API_KEY or not str(OPENROUTER_API_KEY).strip():
        return "❌ Не задано OPENROUTER_API_KEY у .env"

    url = f"{OPENROUTER_API_BASE}/chat/completions"

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY.strip()}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        # Python-urllib часом режуть або віддають 404; OpenRouter також рекомендує Referer/Title для аналітики
        "User-Agent": "SupportTicketBot/1.0 (Python urllib)",
        "Referer": os.getenv("OPENROUTER_HTTP_REFERER", "http://localhost").strip() or "http://localhost",
        # Це лише службові заголовки (ASCII); українська тут була б замінена на «?» після санітизації.
        "X-Title": os.getenv("OPENROUTER_APP_TITLE", "Support Ticket Bot").strip()
        or "Support Ticket Bot",
    }

    payload_base = {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
    }

    try:
        last_status, last_data = 0, {}
        for model_id in _models_to_try():
            payload = {**payload_base, "model": model_id}
            status, data = await _chat_completions_attempt(url, payload, headers)
            last_status, last_data = status, data
            if status == 200:
                return data["choices"][0]["message"]["content"].strip()
            if _no_endpoints_response(status, data):
                continue
            # 429: вже було кілька ретраїв для цієї моделі — пробуємо наступну (інший провайдер).
            if status == 429:
                continue

            return _format_api_error(status, data)

        return _format_api_error(last_status, last_data)

    except Exception as e:
        return f"❌ Помилка запиту: {e}"

# =========================
# Формат тексту повідомлення про тікет
# =========================

def ticket_message_html(
    formatted: str,
    ticket_id: int,
    assigned_line: str | None = None,
    closed: bool = False,
    mentions_override: list[str] | None = None,
) -> str:
    """
    Telegram HTML: для закритого тікета — блок quote (виділення без подвійного курсиву всередині тегів).
    Тіло вже містить дозволені HTML-теги з formatted_plain_to_telegram_html.
    mentions_override: ключ відсутній у записі → усі особи за роллю; порожній список → без блоку @.
    """
    body = formatted_plain_to_telegram_html(formatted)
    mention_suffix = ticket_team_mentions_html_suffix(
        formatted,
        mentions_override=mentions_override,
    )
    if mention_suffix:
        body += mention_suffix
    tid = html_escape(str(ticket_id))
    title = f"<b>📋 Задача №{tid}</b>"
    chunks: list[str] = []

    if closed:
        chunks.append("<b>🔒 <i>СТАТУС: ЗАКРИТО</i></b>\n")
        chunks.append("")
        chunks.append(title)
        chunks.append("")
        chunks.append(f"<blockquote>{body}</blockquote>")
    else:
        chunks.append(title)
        chunks.append("")
        chunks.append(body)

    if assigned_line:
        chunks.append("")
        chunks.append(f"<b>{assigned_line}</b>")
    return "\n".join(chunks)


def assignee_html_line(user) -> str:
    if getattr(user, "username", None):
        name = html_user_fragment(user.username)
        return f"Виконавець: @{name}"
    name = html_user_fragment(user.full_name or "Учасник")
    return f"Виконавець: {name}"


# =========================
# KEYBOARDS
# =========================

def take_kb(ticket_id):
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🎫 Взяти тікет", callback_data=f"take:{ticket_id}")]
        ]
    )

def close_kb(ticket_id):
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="✅ Закрити тікет", callback_data=f"close:{ticket_id}")]
        ]
    )

# =========================
# HANDLERS
# =========================

@dp.message(CommandStart())
async def start(message: Message):
    await message.answer(
        "Бота увімкнено.\n"
        "Створити тікет: <code>/ticket ваш текст проблеми</code>\n"
        "Або призначити одразу: <code>/ticket Тікет для Ілля</code>, далі новий абзац і опис задачі;\n"
        "у один рядок: <code>Тікет для @olleyo — текст задачі</code> або з двокрапкою після імені.\n\n"
        "Кнопку «Закрити» може натиснути лише виконавець.\n\n"
        "Якщо тікет одразу призначено за ніком у Telegram і бот звʼязав акаунт — «Закрити» доступне лише цьому акаунту."
    )


@dp.message(Command("ticket"))
async def cmd_ticket(message: Message, command: CommandObject):
    raw = "" if command.args is None else str(command.args).strip()
    if not raw:
        return await message.answer(
            "Вкажіть опис після команди.\n"
            "Приклад: <code>/ticket не працює вхід</code>\n"
            "Або з призначенням: <code>/ticket Тікет для Ілля</code>, далі опис з нового абзаца."
        )

    payload_for_llm, preset_who = split_preset_assignee_prefix(raw)
    if preset_who is not None and not payload_for_llm.strip():
        return await message.answer(
            "Після «Тікет для …» додай текст задачі: хоча б один непустий абзац після порожнього рядка, "
            "або допиши опис у тому самому рядку після двокрапки / тире."
        )

    wait = await message.answer("Створюю тікет…")

    formatted = await generate_ticket_text(payload_for_llm.strip())

    assign_line_inner: str | None = None
    assigned_uid: int | None = None
    init_status = "open"
    canon_handle: str | None = None

    if preset_who is not None:
        canon_handle, disp_raw = resolve_preset_assignee(preset_who.strip())
        if canon_handle:
            assigned_uid = await telegram_user_id_by_username(message.bot, canon_handle)
        assign_line_inner = preset_assign_footer_line(
            canon_handle, disp_raw, linked_telegram=assigned_uid is not None
        )
        if assign_line_inner and not assign_line_inner.strip():
            assign_line_inner = None
        if assigned_uid is not None:
            init_status = "in_progress"

    ticket_id = generate_ticket_id()
    reply_markup = (
        close_kb(ticket_id) if assigned_uid is not None else take_kb(ticket_id)
    )

    mentions_override_lst: list[str] | None = None
    if canon_handle:
        mentions_override_lst = [_team_username_canonical(canon_handle)]

    body = ticket_message_html(
        formatted,
        ticket_id,
        assigned_line=assign_line_inner,
        closed=False,
        mentions_override=mentions_override_lst,
    )

    sent = await message.answer(
        body,
        reply_markup=reply_markup,
    )

    tk_in: dict = {
        "ticket_id": ticket_id,
        "chat_id": sent.chat.id,
        "message_id": sent.message_id,
        "creator_id": message.from_user.id if message.from_user else None,
        "text": raw,
        "formatted": formatted,
        "status": init_status,
        "assigned": assigned_uid,
        "preset_assign_who": preset_who,
        "created_at": datetime.utcnow().isoformat(),
    }
    if mentions_override_lst is not None:
        tk_in["mentions_override"] = mentions_override_lst
    create_ticket(tk_in)

    await wait.delete()


@dp.callback_query(F.data.startswith("take:"))
async def take(call: CallbackQuery):
    ticket_id = int(call.data.split(":")[1])
    t = get_ticket(ticket_id)

    if not t:
        return await call.answer("Тікет не знайдено", show_alert=True)

    if t["assigned"]:
        return await call.answer("Тікет уже призначено виконавцю", show_alert=True)

    user = call.from_user

    mo_take = [_team_username_canonical(user.username)] if getattr(user, "username", None) else []

    assigned_line = assignee_html_line(user)
    public_text = ticket_message_html(
        t["formatted"],
        ticket_id,
        assigned_line=assigned_line,
        closed=False,
        mentions_override=mo_take,
    )

    update_ticket(ticket_id, {
        "assigned": user.id,
        "status": "in_progress",
        "mentions_override": mo_take,
    })
    await call.message.edit_text(
        public_text,
        reply_markup=close_kb(ticket_id),
        parse_mode=ParseMode.HTML,
    )
    return await call.answer("Тікет закріплено за вами")


@dp.callback_query(F.data.startswith("close:"))
async def close_ticket(call: CallbackQuery):
    ticket_id = int(call.data.split(":")[1])
    t = get_ticket(ticket_id)

    if not t:
        return await call.answer("Тікет не знайдено", show_alert=True)

    if t["assigned"] != call.from_user.id:
        return await call.answer("Це може зробити лише виконавець тікета", show_alert=True)

    if t.get("status") == "closed":
        return await call.answer("Тікет уже закритий", show_alert=True)

    update_ticket(ticket_id, {
        "status": "closed",
        "closed_at": datetime.utcnow().isoformat(),
    })

    mo_closed = ticket_record_mentions_override(t)
    main_html = ticket_message_html(
        t["formatted"],
        ticket_id,
        assigned_line=None,
        closed=True,
        mentions_override=mo_closed,
    )

    bot = call.message.bot
    try:
        await call.message.edit_text(
            main_html,
            reply_markup=None,
            parse_mode=ParseMode.HTML,
        )
    except Exception:
        await bot.edit_message_text(
            chat_id=t["chat_id"],
            message_id=t["message_id"],
            text=main_html,
            reply_markup=None,
            parse_mode=ParseMode.HTML,
        )

    await call.answer("Тікет закрито")


@dp.callback_query()
async def ignore_unknown_callback(call: CallbackQuery):
    await call.answer()

# =========================
# RUN
# =========================

async def main():
    ensure_storage()
    print("Бота запущено")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())