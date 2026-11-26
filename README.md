# Familyhub

Familienplaner als Seitenleisten-Panel für Home Assistant: Wochenkalender mit Klender-Abo und
Personenzuordnung, Essensplan (Do–Mi, verschiebbar), Aufgaben und Routinen mit „Erledigt von“,
Alexa-Einkaufsliste und Unternehmungen.

## Neu in 1.4.9

- Behoben: In Klender gelöschte einzelne Termine einer Serie (z. B. jedes zweite Wochenende) wurden teils weiter angezeigt. Die Kalender-Bibliothek übersprang Ausnahmen nicht zuverlässig.

## Neu in 1.4.8

- Robuster gegen Updates ohne Neustart: Fehlt der angefragte Build-Ordner, liefert Familyhub die Dateien aus dem aktuellen Ordner aus. Die Meldung „Unable to load custom panel“ zwischen Update und Neustart tritt damit nicht mehr auf.
- Fester Name für das Panel-Element, damit altes Backend und neue Dateien zusammenpassen.

## Neu in 1.4.7
- Müllabfuhr-Termine (Bio-, Rest-, Papier-, Gelbe Tonne, Gelber Sack) ohne Ortsangabe.

## Neu in 1.4.6
- Klender: Ort wird angezeigt (📍, in der Termin-Ansicht als Link zu Apple Karten).
- Endzeit wird angezeigt (z. B. 18:10–19:00).
- Mehrtägige Termine erscheinen an jedem Tag („Tag 2/3“).
- „Neu“-Markierung für Termine, die in den letzten 2 Tagen in Klender angelegt oder geändert wurden.

## Neu in 1.4.5
- Beim Abhaken können mehrere Personen als „Erledigt von“ angegeben werden; die Auswertung zählt die Aufgabe bei jeder davon.

## Neu in 1.4.4
- Aufgaben und Routinen können mehreren Personen zugewiesen werden (nichts ankreuzen = freie Aufgabe).
- Beim Abhaken ist „Erledigt von“ optional.

## Neu in 1.4.3
- Übersicht: die Links „Einkaufsliste“ und „Unternehmungen“ unten entfallen (über die Seitenleiste bzw. die Symbolleiste im Vollbild erreichbar).

## Neu in 1.4.2
- Vollbild: farbige Symbole in der Kopfzeile springen zu Kalender, Essensplan, Aufgaben, Einkäufen und Unternehmungen.
- Unterseiten im Vollbild haben einen Knopf „← Übersicht“; nach 2 Minuten ohne Berührung geht es automatisch zurück (einstellbar).
- Kleine Ziehgriffe auf allen Seiten.

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
