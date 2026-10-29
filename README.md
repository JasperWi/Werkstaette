# Werkstatt-Verwaltung

Kurse planen, Wahlen zuordnen und über mehrere Schuljahre im Blick behalten. Ein Schuljahr hat drei Trimester. Jeder Jahrgang läuft als farbige Linie durch die Bänder.

Die Seite liegt unter [jasperwi.github.io/Werkstaette](https://jasperwi.github.io/Werkstaette/).

## Trimester

Der Zeitstrahl zeigt, welches Trimester schon belegt ist und welches nur geplant. Gestrichelte Kästen sind noch offen. Die Linien gehören zu den Einschulungsjahrgängen und laufen nur durch die Bänder, in denen dieser Jahrgang wählt.

![Zeitstrahl 2019/2020 mit drei Bändern und den Jahrgängen als farbige Linien](docs/screenshots/trimester-2019.png)

![Zeitstrahl 2026/2027: das letzte Trimester ist nur geplant, die Linien enden am offenen Rand](docs/screenshots/trimester-2026.png)

Ein Klick auf einen Jahrgang zeigt, was ab dem nächsten Trimester noch fest gewählt werden muss und wie viele Wahlen frei bleiben.

![Jahrgang 2024: Holz und Metall müssen beide belegt werden, zwei Wahlen bleiben frei](docs/screenshots/trimester-zeitstrahl.png)

Steht zwischen den Kursen **und**, müssen beide belegt werden. Das ist die Regel „Alle Kurse“. Eine Regel heißt nicht plötzlich „oder“, nur weil das Wort im Namen vorkommt. „Oder“ und „n von diesen“ kommen von der Regel **Mindestanzahl**.

## Wahl und Zuordnung

Pro Band eine Wahl-Datei hochladen, dann automatisch zuordnen oder die Karten von Hand ziehen. Ein Hinweis bleibt auf der Schülerkarte, solange die Bedingung gilt, und lässt sich auf das Warndreieck einklappen. Eine volle Werkstatt erkennt man an der roten Zahl in der Spalte, nicht an einem Hinweis auf jeder Karte.

![Manuelle Anpassung: die Karten von Anna, Ben und Clara liegen unter Nicht zugeordnet](docs/screenshots/wahl.png)

## Schüler

Klasse, Einschulungsjahr und die offenen Regeln stehen auf der Karte. „Alle Kurse“ ist erst erfüllt, wenn jeder genannte Kurs mindestens einmal belegt wurde.

![Pflicht bis Stufe 6: Holz und Metall fehlen noch](docs/screenshots/schueler-pflicht.png)

## Belegungs-Regeln

Vier Arten:

- **Alle Kurse** — jeder ausgewählte Kurs mindestens einmal, zum Beispiel Holzwerkstatt und Textil.
- **Mindestanzahl** — nur so viele Kurse aus einer Liste, zum Beispiel einer von zweien oder zwei von vier.
- **Folgekurs** — nach einem Kurs im nächsten Trimester ein bestimmter Kurs, auf Wunsch im selben Band.
- **Freitext** — eine Erinnerung zum Abhaken, ohne Kursliste.

Der Zeitraum ist eine Spanne von Klassenstufen. Zusätzlich kann die Regel auf einen Einschulungsjahrgang begrenzt werden.

![Regelliste: Alle Kurse neben einer Freitext-Regel](docs/screenshots/belegungsregeln.png)

## Berichte

PDF und Excel für das gewählte Trimester: Werkstätten, Klassen, und die belegten Kurse je Schüler über die Trimester. Der Kursverlauf ist quer und trennt Schuljahr und Trimester.

![Berichte: Werkstatt-Übersicht, Klassen und der Anfang der belegten Kurse](docs/screenshots/berichte.png)

## Werkstätten

Jede Werkstatt hat Farbe, Kapazität, Lehrkraft und Raum. Läuft sie in mehreren Bändern mit anderem Raum oder anderer Lehrkraft, bekommt das Band eine eigene Variante. Kurse, die nicht mehr laufen, lassen sich archivieren.

## Daten

Oben rechts liegt der Export und der Import als ZIP. Ein Wahl-Upload ändert einen gesetzten Jahrgang nicht. Ersetzt ein ZIP auf diesem Weg alle Daten, werden fehlende Einschulungsjahre aus dem letzten Trimester mit Klasse ergänzt.

Zum Ausprobieren liegen zwei Beispieldateien unter `scripts/output/`: die kleinere `werkstatt-demo.zip` und `werkstatt-demo-10-jahre.zip` über zehn Schuljahre.

## Starten

```bash
npm install
npm start
```

Die App öffnet sich unter [http://localhost:3000](http://localhost:3000).
