# 🚗 Autohaus Meisner – Hol & Bring Service

Web-App zur Tourenplanung für den Hol- und Bringservice.

## Features
- 4 Touren pro Slot (Vormittag / Nachmittag) = 8 Touren pro Tag
- Liefern + Abholen pro Tour
- Leihwagen-Anzeige (LW / oL)
- Touren sperren (wenn Fahrer nicht verfügbar)
- Echtzeit-Updates via WebSocket
- Benutzerverwaltung mit 3 Rollen:
  - **Admin** – alles + Benutzerverwaltung
  - **Schreiben** – Touren bearbeiten
  - **Lesen** – nur ansehen

## Deployment mit Portainer

### Option A: docker-compose.yml in Portainer hochladen

1. In Portainer: **Stacks → Add Stack**
2. `docker-compose.yml` hochladen oder Inhalt einfügen
3. **Wichtig:** `JWT_SECRET` in der compose-Datei ändern!
4. Stack deployen → App läuft auf Port 3000

### Option B: Aus Sourcecode bauen

```bash
# Auf dem Server:
git clone / Dateien hochladen
cd autohaus-meisner
docker-compose up -d --build
```

### Option C: Image bauen und in Registry pushen

```bash
docker build -t autohaus-meisner:latest .
docker tag autohaus-meisner:latest your-registry/autohaus-meisner:latest
docker push your-registry/autohaus-meisner:latest
```

Dann in docker-compose.yml `build: .` durch `image: your-registry/autohaus-meisner:latest` ersetzen.

## Standard-Login

Nach dem ersten Start:
- **Benutzer:** `admin`
- **Passwort:** `admin123`

⚠️ **Passwort sofort ändern!** (Admin-Panel → Benutzer bearbeiten)

## Weitere Benutzer anlegen

Als Admin einloggen → Admin-Button → Benutzerverwaltung → Benutzer anlegen

## Umgebungsvariablen

| Variable | Standard | Beschreibung |
|----------|---------|--------------|
| `PORT` | 3000 | HTTP-Port |
| `DB_PATH` | /data/meisner.db | Pfad zur SQLite-Datenbank |
| `JWT_SECRET` | (ändern!) | Geheimschlüssel für Sessions |

## Datensicherung

Die Datenbank liegt im Docker-Volume `meisner-data`. Backup:

```bash
docker cp meisner-holbring:/data/meisner.db ./backup-$(date +%Y%m%d).db
```
