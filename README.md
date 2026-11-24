# Familyhub

Familienplaner als Seitenleisten-Panel für Home Assistant: Wochenkalender mit Klender-Abo und
Personenzuordnung, Essensplan (Do–Mi, verschiebbar), Aufgaben und Routinen mit „Erledigt von“,
Alexa-Einkaufsliste und Unternehmungen.

## Neu in 1.4.1
- Übersicht: heute über die ganze Breite, darunter 6 Tage; separate Wetterkachel entfernt.
- Kleinere Ziehgriffe bei Essensplan und Terminen.
- Vollbild passt ohne Scrollen auf den Bildschirm; Beenden-Symbol neben der Uhr.

## Neu in 1.4.0
- **Wetter** auf der Übersicht: aktuell im Kopfbereich, pro Tag im Kalender und als 7-Tage-Kachel
  (Wetter-Entität automatisch, Standard `weather.forecast_home`).
- **Übersicht** zeigt heute + 6 Tage.
- **Routinen** erscheinen in der Aufgabenkachel nur noch einmal (nächster offener Termin).
- **Lokale Termine** (in Familyhub angelegt) sind mit „Lokal“ gekennzeichnet, verschobene
  Klender-Termine mit „Verschoben“.
- **Vollbild für Tablets** (Knopf unten rechts auf der Übersicht): blendet Home Assistant aus,
  hält den Bildschirm wach und zeigt eine große Uhr.
- **Einbrennschutz**: Inhalt verschiebt sich alle 2 Minuten minimal, Nachtmodus (dunkel, nur Uhr,
  wandert jede Minute) und Bildschirmschoner nach einstellbarer Zeit. Einstellungen pro Gerät unter
  Einstellungen → Tablet & Vollbild.
- Keine persönlichen Entitäts-IDs mehr im Code.

## Installation über HACS / Marketplace
1. Dieses Repository als benutzerdefiniertes Repository (Kategorie *Integration*) hinzufügen.
2. „Familyhub“ herunterladen und Home Assistant neu starten.
3. Bestehende Daten bleiben erhalten (gespeichert in `.storage/familyhub`).
