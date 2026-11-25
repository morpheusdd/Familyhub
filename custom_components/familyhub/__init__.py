"""Local shared Familyhub storage, calendar relay and Alexa to-do adapter."""
from __future__ import annotations

import asyncio
from copy import deepcopy
import json
from datetime import date as Date
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlsplit, urlunsplit

import voluptuous as vol
from homeassistant.components import frontend as ha_frontend, panel_custom, websocket_api
from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import Context
from homeassistant.auth.permissions.const import POLICY_READ, POLICY_CONTROL
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
from datetime import timedelta

from .const import DOMAIN, VERSION, DEFAULT_TODO, DEFAULT_WEATHER

HOUSEHOLD = "haushaltszentrale-v1"
AVATARS = "haushaltszentrale-avatars-v1"
PEOPLE = "haushaltszentrale-klender-people-v1"
RULES = "haushaltszentrale-klender-rules-v1"
FEED = "haushaltszentrale-klender-v1"
SHOP = "familyhub-shopping-meta-v1"
SHOP_CACHE = "familyhub-shopping-cache-v1"
CATEGORIES = "familyhub-calendar-categories-v1"
SHOP_CATEGORIES = "familyhub-shop-categories-v1"
CALENDAR_MOVES = "familyhub-calendar-moves-v1"
KEYS = {CALENDAR_MOVES, SHOP_CATEGORIES, CATEGORIES, HOUSEHOLD, AVATARS, PEOPLE, RULES, FEED, SHOP, SHOP_CACHE}
MEMBERS = {f"member-{number}" for number in range(1, 6)}
EVENT = "familyhub_updated"


def calendar_url(value):
    """Accept HTTPS export links from Klender only, including redirects."""
    value = re.sub(r"^webcal:", "https:", value.strip(), flags=re.I)
    parts = urlsplit(value)
    if (parts.scheme != "https" or parts.username or parts.password
        or parts.port not in (None, 443)
        or not re.fullmatch(r"(?:[a-z0-9-]+\.)*klender\.(?:nl|de|co\.uk)", parts.hostname or "", re.I)):
        raise ValueError("Bitte verwende den Exportlink direkt aus Klender.")
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def validate_value(key, value):
    """Reject malformed or excessively large shared data before saving."""
    if value is None:
        return
    if not isinstance(value, dict) or len(json.dumps(value)) > 4_000_000:
        raise ValueError("Ungültige oder zu große Daten.")
    if key == CALENDAR_MOVES:
        if len(value) > 10000:
            raise ValueError("Zu viele lokale Verschiebungen.")
        for uid, move in value.items():
            if not isinstance(uid, str) or not uid.startswith("klender:") or not isinstance(move, dict):
                raise ValueError("Ungültige lokale Verschiebung.")
            for field in ("date", "originalDate"):
                Date.fromisoformat(move.get(field, ""))
    if key == HOUSEHOLD:
        entries = value.get("entries")
        if value.get("version") != 1 or not isinstance(entries, list) or len(entries) > 10000:
            raise ValueError("Ungültiger Datenbestand.")
        ids = set()
        for row in entries:
            if (not isinstance(row, dict) or row.get("type") not in
                {"task", "routine", "buy", "calendar", "meal", "mealidea", "outing"}
                or not isinstance(row.get("id"), str) or row["id"] in ids
                or not isinstance(row.get("title"), str) or not row["title"].strip()):
                raise ValueError("Ungültiger Eintrag.")
            ids.add(row["id"])
            for field in ["title", "notes", "category", "url", "time", "date", "quantity", "list"]:
                if field in row and (not isinstance(row[field], str) or len(row[field]) > 5000):
                    raise ValueError("Ungültiges Textfeld.")
            if row.get("date"):
                Date.fromisoformat(row["date"])
            if row.get("time") and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", row["time"]):
                raise ValueError("Ungültige Uhrzeit.")
            if row.get("assignee") and row["assignee"] not in MEMBERS:
                raise ValueError("Unbekannte Person.")
            if row.get("suggestedBy") and row["suggestedBy"] not in MEMBERS:
                raise ValueError("Unbekannte Person.")
            if row.get("completedBy") and (not isinstance(row["completedBy"], str) or row["completedBy"] not in MEMBERS):
                raise ValueError("Unbekannte Person.")
            if not isinstance(row.get("completedByList", []), list) or not set(row.get("completedByList", [])).issubset(MEMBERS):
                raise ValueError("Unbekannte Person.")
            if not isinstance(row.get("attendees", []), list) or not set(row.get("attendees", [])).issubset(MEMBERS):
                raise ValueError("Unbekannte Person.")
        names = value.get("memberNames", {})
        if not isinstance(names, dict) or not set(names).issubset(MEMBERS):
            raise ValueError("Ungültige Familiennamen.")
        if any(not isinstance(name, str) or len(name) > 45 for name in names.values()):
            raise ValueError("Ungültige Familiennamen.")
    if key == AVATARS:
        if not set(value).issubset(MEMBERS):
            raise ValueError("Unbekannte Person.")
        for photo in value.values():
            if not isinstance(photo, str) or len(photo) > 100000 or not re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+", photo):
                raise ValueError("Ungültiges Profilbild.")


class Hub:
    def __init__(self, hass, entry):
        self.hass = hass
        self.entry = entry
        self.store = Store(hass, 1, DOMAIN)
        self.lock = asyncio.Lock()
        self.feed_lock = asyncio.Lock()
        self.values = {HOUSEHOLD: {"version": 1, "entries": [
            {"id": f"idea-{i}", "type": kind, "title": title, "category": category, "priority": "low", "date": "", "done": False}
            for i, (kind, title, category) in enumerate([
                ("mealidea", "Ofengemüse mit Feta", "Vorschlag"),
                ("mealidea", "Wraps zum Selbstfüllen", "Vorschlag"),
                ("mealidea", "Kartoffelsuppe", "Vorschlag"),
                ("outing", "Spaziergang mit den Hunden", "Draußen"),
                ("outing", "Kletterwald", "Sport"),
                ("outing", "Spieleabend zu Hause", "Zu Hause"),
            ])
        ], "memberNames": {}}}
        self.revisions = {}
        self.feed_error = ""
        self.feed_attempt = 0

    async def load(self):
        saved = await self.store.async_load()
        if saved is not None:
            self.values = saved["values"]
            self.revisions = saved["revisions"]

    async def write(self, key, value, expected=None):
        async with self.lock:
            if expected is not None and expected != self.revisions.get(key, 0):
                raise ValueError("Der Datenstand wurde auf einem anderen Gerät geändert. Bitte erneut versuchen.")
            validate_value(key, value)
            next_values = {**self.values, key: deepcopy(value)}
            next_revisions = {**self.revisions, key: self.revisions.get(key, 0) + 1}
            await self.store.async_save({"values": next_values, "revisions": next_revisions})
            self.values, self.revisions = next_values, next_revisions
            self.hass.bus.async_fire(EVENT)
            return {"value": value, "revision": self.revisions[key]}

    async def fetch_calendar(self, value=None):
        async with self.feed_lock:
            current = self.values.get(FEED) or {}
            if value is None:
                value = current.get("url")
            if not value:
                return None
            self.feed_attempt = time.time()
            try:
                url = calendar_url(value)
                session = async_get_clientsession(self.hass)
                async with asyncio.timeout(20):
                    for _ in range(4):
                        async with session.get(url, allow_redirects=False, headers={"Accept": "text/calendar", "Cache-Control": "no-cache"}) as response:
                            if response.status in {301, 302, 303, 307, 308}:
                                location = response.headers.get("Location")
                                if not location:
                                    raise ValueError("Ungültige Weiterleitung.")
                                url = calendar_url(urljoin(url, location))
                                continue
                            response.raise_for_status()
                            raw = bytearray()
                            async for chunk in response.content.iter_chunked(65536):
                                raw.extend(chunk)
                                if len(raw) > 2_000_000:
                                    raise ValueError("Der Kalender ist größer als 2 MB.")
                            text = raw.decode("utf-8-sig")
                            if "BEGIN:VCALENDAR" not in text or "END:VCALENDAR" not in text:
                                raise ValueError("Dieser Link liefert keinen ICS-Kalender.")
                            payload = {"url": calendar_url(value), "raw": text, "updatedAt": round(time.time() * 1000)}
                            await self.write(FEED, payload)
                            self.feed_error = ""
                            return payload
                    raise ValueError("Zu viele Weiterleitungen.")
            except Exception as error:
                self.feed_error = "Klender konnte nicht aktualisiert werden. Der letzte Kalender bleibt verfügbar."
                if isinstance(error, ValueError):
                    self.feed_error = str(error)
                raise ValueError(self.feed_error) from error

    async def refresh(self, _now):
        if self.values.get(FEED):
            try:
                await self.fetch_calendar()
            except ValueError:
                pass

    def todo_entity(self):
        """Return the configured shopping list, or find one automatically."""
        entity_id = self.entry.data.get("todo_entity") or DEFAULT_TODO
        if entity_id:
            return entity_id
        candidates = sorted(self.hass.states.async_entity_ids("todo"))
        for word in ("einkauf", "shopping"):
            for candidate in candidates:
                if word in candidate:
                    return candidate
        return ""

    def weather_entity(self):
        """Return the configured weather entity, or the first one available."""
        entity_id = self.entry.data.get("weather_entity") or DEFAULT_WEATHER
        if self.hass.states.get(entity_id) is not None:
            return entity_id
        candidates = sorted(self.hass.states.async_entity_ids("weather"))
        return candidates[0] if candidates else ""

    async def weather(self, user):
        """Current conditions and a daily forecast for the overview."""
        entity_id = self.weather_entity()
        if not entity_id:
            raise ValueError("Keine Wetter-Entität gefunden.")
        if not user.permissions.check_entity(entity_id, POLICY_READ):
            raise ValueError("Für die Wetter-Entität fehlen die Berechtigungen.")
        state = self.hass.states.get(entity_id)
        forecast = []
        try:
            response = await self.hass.services.async_call(
                "weather", "get_forecasts", {"entity_id": entity_id, "type": "daily"},
                blocking=True, return_response=True, context=Context(user_id=user.id))
            forecast = (response or {}).get(entity_id, {}).get("forecast", []) or []
        except Exception:  # The current state is still useful without a forecast.
            forecast = []
        keep = ("datetime", "condition", "temperature", "templow", "precipitation_probability", "precipitation")
        return {
            "entity": entity_id,
            "condition": state.state if state else "",
            "temperature": state.attributes.get("temperature") if state else None,
            "unit": state.attributes.get("temperature_unit", "°C") if state else "°C",
            "forecast": [{k: day.get(k) for k in keep if k in day} for day in forecast[:10]],
        }

    def snapshot(self):
        return {"values": self.values, "revisions": self.revisions,
                "todo_entity": self.todo_entity(),
                "weather_entity": self.weather_entity(),
                "calendar_error": self.feed_error}

    async def shopping(self, operation, payload, user_id):
        entity_id = self.todo_entity()
        if not re.fullmatch(r"todo\.[a-z0-9_]+", entity_id or "") or self.hass.states.get(entity_id) is None:
            raise ValueError("Die Alexa-To-do-Entität ist nicht verfügbar. Prüfe Alexa Devices und die Familyhub-Einstellungen.")
        data = {"entity_id": entity_id}
        context = Context(user_id=user_id)
        if operation == "list":
            response = await self.hass.services.async_call("todo", "get_items", data, blocking=True,
                                                          return_response=True, context=context)
            items = (response or {}).get(entity_id, {}).get("items", [])
            cache = self.values.get(SHOP_CACHE) or {}
            if cache.get("entity") != entity_id or cache.get("items") != items:
                await self.write(SHOP_CACHE, {"entity": entity_id, "items": items, "updatedAt": round(time.time() * 1000)})
            return items
        if operation == "add":
            title = payload.get("title", "").strip()
            if not title or len(title) > 140:
                raise ValueError("Bitte einen Artikelnamen eingeben.")
            service = "add_item"
            data["item"] = title
        elif operation == "check":
            uid = payload.get("uid")
            if not isinstance(uid, str) or not uid:
                raise ValueError("Ungültiger Artikel.")
            service = "update_item"
            data.update(item=uid, status="completed" if payload.get("done") else "needs_action")
        else:
            raise ValueError("Unbekannte Listenaktion.")
        await self.hass.services.async_call("todo", service, data, blocking=True, context=context)
        self.hass.bus.async_fire(EVENT)
        return True


async def async_setup(hass, config):
    websocket_api.async_register_command(hass, ws_hub)
    return True


ASSETS = Path(__file__).parent / "frontend"


def _asset_path(build, filename):
    """Find an asset; fall back to the newest build folder.

    After a Marketplace update the old build folder is gone while Home Assistant
    still runs the previous version until it restarts. Serving the files from
    the current folder keeps the panel working in that window.
    """
    if not re.fullmatch(r"build-[0-9]+(?:\.[0-9]+)*", build):
        return None
    folder = ASSETS / build
    if not folder.is_dir():
        builds = [p for p in ASSETS.glob("build-*") if p.is_dir()]
        if not builds:
            return None
        folder = max(builds, key=lambda p: [int(x) for x in p.name[6:].split(".") if x.isdigit()])
    path = (folder / filename).resolve()
    if folder.resolve() not in path.parents or not path.is_file():
        return None
    return path


class FamilyhubAssetsView(HomeAssistantView):
    """Static Familyhub frontend files (no secrets, like the former static path)."""

    url = "/familyhub-assets/{build}/{filename:.+}"
    name = "familyhub:assets"
    requires_auth = False

    async def get(self, request, build, filename):
        path = await request.app["hass"].async_add_executor_job(_asset_path, build, filename)
        if path is None:
            raise web.HTTPNotFound()
        return web.FileResponse(path, headers={"Cache-Control": "no-cache"})


async def async_setup_entry(hass, entry):
    hub = Hub(hass, entry)
    await hub.load()
    hass.data[DOMAIN] = hub
    if not hass.data.get("familyhub_static_registered"):
        hass.http.register_view(FamilyhubAssetsView())
        hass.data["familyhub_static_registered"] = True
    await panel_custom.async_register_panel(
        hass, frontend_url_path="familyhub", webcomponent_name="familyhub-panel",
        sidebar_title="Familyhub", sidebar_icon="mdi:home-heart",
        module_url=f"/familyhub-assets/build-{VERSION}/panel.js",
        embed_iframe=False, require_admin=False,
    )
    entry.async_on_unload(async_track_time_interval(hass, hub.refresh, timedelta(minutes=15)))
    return True


async def async_unload_entry(hass, entry):
    ha_frontend.async_remove_panel(hass, "familyhub")
    hass.data.pop(DOMAIN, None)
    return True


@websocket_api.websocket_command({
    vol.Required("type"): "familyhub/request",
    vol.Required("action"): str,
    vol.Optional("payload", default={}): dict,
})
@websocket_api.async_response
async def ws_hub(hass, connection, msg):
    hub = hass.data.get(DOMAIN)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Familyhub ist nicht geladen.")
        return
    action, payload = msg["action"], msg["payload"]
    try:
        if action == "snapshot":
            result = hub.snapshot()
        elif action == "write":
            key = payload.get("key")
            if key not in KEYS - {FEED, SHOP_CACHE}:
                raise ValueError("Unbekannter Speicherbereich.")
            result = await hub.write(key, payload.get("value"), payload["revision"])
        elif action == "calendar":
            # Link configuration may be changed by administrators.
            if payload.get("url") and not connection.user.is_admin:
                raise ValueError("Den Kalenderlink kann nur ein Administrator ändern.")
            result = await hub.fetch_calendar(payload.get("url"))
        elif action == "calendar_remove":
            if not connection.user.is_admin:
                raise ValueError("Das Kalender-Abo kann nur ein Administrator entfernen.")
            async with hub.feed_lock:
                result = await hub.write(FEED, None)
        elif action == "settings/todo":
            if not connection.user.is_admin:
                raise ValueError("Die Listenverbindung kann nur ein Administrator ändern.")
            entity = payload.get("entity", "")
            if not re.fullmatch(r"todo\.[a-z0-9_]+", entity):
                raise ValueError("Bitte eine gültige todo.-Entitäts-ID eingeben.")
            hass.config_entries.async_update_entry(hub.entry, data={**hub.entry.data, "todo_entity": entity})
            result = True
        elif action == "weather":
            result = await hub.weather(connection.user)
        elif action == "settings/weather":
            if not connection.user.is_admin:
                raise ValueError("Die Wetter-Entität kann nur ein Administrator ändern.")
            entity = payload.get("entity", "")
            if not re.fullmatch(r"weather\.[a-z0-9_]+", entity) or hass.states.get(entity) is None:
                raise ValueError("Bitte eine vorhandene weather.-Entität eingeben.")
            hass.config_entries.async_update_entry(hub.entry, data={**hub.entry.data, "weather_entity": entity})
            result = True
        elif action.startswith("shopping/"):
            entity = hub.todo_entity()
            policy = POLICY_READ if action == "shopping/list" else POLICY_CONTROL
            if not connection.user.permissions.check_entity(entity, policy):
                raise ValueError("Für diese Liste fehlen die Berechtigungen.")
            result = await hub.shopping(action.split("/")[1], payload, connection.user.id)
        else:
            raise ValueError("Unbekannte Familyhub-Aktion.")
        connection.send_result(msg["id"], result)
    except Exception as error:
        connection.send_error(msg["id"], "familyhub_error",
                              str(error) if isinstance(error, ValueError) else "Aktion fehlgeschlagen. Prüfe die Home-Assistant-Protokolle und die Verbindung zur Integration.")
